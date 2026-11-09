package com.kb.note;

import com.kb.activity.ActivityService;
import com.kb.common.ApiException;
import com.kb.common.PageResponse;
import com.kb.common.SearchText;
import com.kb.common.Times;
import com.kb.folder.FolderRepository;
import com.kb.history.VersionRepository;
import com.kb.history.VersionRow;
import com.kb.link.LinkService;
import com.kb.tag.TagRef;
import com.kb.tag.TagRepository;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** API.md §4 笔记接口。 */
@Service
public class NoteService {

    private static final int MAX_TITLE_LENGTH = 512;
    private static final int MAX_TAG_NAME_LENGTH = 64;

    /** API.md §4.4：正文上限 2 MB（按 UTF-8 字节数），公网暴露下的必要护栏。 */
    private static final int MAX_CONTENT_BYTES = 2 * 1024 * 1024;

    /**
     * activities.action 的两个取值。SCHEMA §1 的 CHECK 约束与 API.md §9 是唯一真源；
     * {@link ActivityService} 暂时只公开了 view/restore/import/export/delete 常量。
     */
    private static final String ACTION_CREATE = "create";
    private static final String ACTION_EDIT = "edit";

    private final NoteRepository notes;
    private final VersionRepository versions;
    private final TagRepository tags;
    private final FolderRepository folders;
    private final LinkService links;
    private final ActivityService activities;

    public NoteService(NoteRepository notes, VersionRepository versions, TagRepository tags,
            FolderRepository folders, LinkService links, ActivityService activities) {
        this.notes = notes;
        this.versions = versions;
        this.tags = tags;
        this.folders = folders;
        this.links = links;
        this.activities = activities;
    }

    // ---------------------------------------------------------------- 查询

    public PageResponse<NoteListItem> list(long spaceId, NoteQuery query) {
        long total = notes.count(spaceId, query);
        return PageResponse.of(items(spaceId, notes.list(spaceId, query)), query.page(), query.size(), total);
    }

    public NoteDetail detail(long spaceId, long noteId) {
        return toDetail(spaceId, notes.findAlive(spaceId, noteId)
                .orElseThrow(() -> ApiException.notFound("笔记不存在")));
    }

    // ---------------------------------------------------------------- 写入

    @Transactional
    public NoteDetail create(long userId, long spaceId, CreateNoteRequest request) {
        String title = normalizedTitle(request.title());
        String content = validatedContent(request.content() == null ? "" : request.content());
        requireFolder(spaceId, request.folderId());
        long id = notes.insert(spaceId, request.folderId(), title, content, Excerpt.of(content),
                searchBlob(title, content), Times.now());
        links.rebuild(spaceId, id, content);
        links.backfillDangling(spaceId, id, title);
        activities.record(userId, id, ACTION_CREATE);
        return detail(spaceId, id);
    }

    /** PATCH 语义见 API.md §4：仅 content / title 变化才产生历史版本。 */
    @Transactional
    public NoteDetail patch(long userId, long spaceId, long noteId, NotePatch patch) {
        NoteRow current = notes.findAlive(spaceId, noteId)
                .orElseThrow(() -> ApiException.notFound("笔记不存在"));
        String title = patch.hasTitle() ? normalizedTitle(patch.title()) : current.title();
        String content = patch.hasContent() ? validatedContent(patch.content()) : current.content();
        // 先归一化再比较：只改了首尾空白不应白白产生一个历史版本
        boolean titleChanged = !title.equals(current.title());
        boolean contentChanged = !content.equals(current.content());

        Long folderId = current.folderId();
        if (patch.hasFolderId()) {
            requireFolder(spaceId, patch.folderId());
            folderId = patch.folderId();
        }
        boolean favorite = patch.hasFavorite() ? patch.favorite() : current.favorite();
        boolean pinned = patch.hasPinned() ? patch.pinned() : current.pinned();
        int sortOrder = patch.hasSortOrder() ? patch.sortOrder() : current.sortOrder();
        String now = Times.now();

        if (titleChanged || contentChanged) {
            // 1) 旧内容先落成历史版本（version = 旧版本号） 2) 再更新正文并把 version 自增
            versions.insert(noteId, current.version(), current.title(), current.content(), now, userId);
            notes.updateContent(spaceId, noteId, title, content, Excerpt.of(content),
                    searchBlob(title, content), current.version() + 1, now);
            if (contentChanged) {
                links.rebuild(spaceId, noteId, content);
            }
            if (titleChanged) {
                links.backfillDangling(spaceId, noteId, title);
            }
            // 只有正文/标题真的变了才算一次编辑；收藏/置顶/移动目录不写日志
            activities.record(userId, noteId, ACTION_EDIT);
        }
        notes.updateMeta(spaceId, noteId, folderId, favorite, pinned, sortOrder, now);
        return detail(spaceId, noteId);
    }

    /** SCHEMA §3：软删笔记，links 与 note_tags 保留，恢复后标签与出链还在。 */
    @Transactional
    public void delete(long userId, long spaceId, long noteId) {
        if (notes.softDelete(spaceId, noteId, Times.now()) == 0) {
            throw ApiException.notFound("笔记不存在");
        }
        activities.record(userId, noteId, ActivityService.ACTION_DELETE);
    }

    /** API.md §6 {@code PUT /api/notes/{id}/tags}：覆盖式设置，不存在的标签自动创建。 */
    @Transactional
    public NoteDetail setTags(long spaceId, long noteId, List<String> names) {
        NoteRow current = notes.findAlive(spaceId, noteId)
                .orElseThrow(() -> ApiException.notFound("笔记不存在"));
        Map<String, Long> resolved = new LinkedHashMap<>();
        for (String raw : names) {
            if (raw == null) {
                throw ApiException.validation("标签名不能为空", "tagNames");
            }
            String name = raw.trim();
            if (name.isEmpty()) {
                continue;
            }
            if (name.length() > MAX_TAG_NAME_LENGTH) {
                throw ApiException.validation("标签名最长 " + MAX_TAG_NAME_LENGTH + " 字", "tagNames");
            }
            String key = name.toLowerCase(Locale.ROOT);
            if (!resolved.containsKey(key)) {
                resolved.put(key, resolveTagId(spaceId, name));
            }
        }
        tags.replaceNoteTags(noteId, new ArrayList<>(resolved.values()));
        notes.updateMeta(spaceId, noteId, current.folderId(), current.favorite(), current.pinned(),
                current.sortOrder(), Times.now());
        return detail(spaceId, noteId);
    }

    /**
     * API.md §4 回滚：**先把当前内容存成一个新版本**，再用目标版本覆盖，
     * 因此回滚本身也是可回滚的，任何操作都不丢数据。
     */
    @Transactional
    public NoteDetail restore(long userId, long spaceId, long noteId, int version) {
        NoteRow current = notes.findAlive(spaceId, noteId)
                .orElseThrow(() -> ApiException.notFound("笔记不存在"));
        VersionRow target = versions.resolve(spaceId, noteId, version)
                .orElseThrow(() -> ApiException.notFound("版本不存在"));
        if (target.version() == current.version()) {
            // API.md §4.4：对当前版本回滚是 no-op —— 不产生新版本、不改正文、不记 edit 日志
            return toDetail(spaceId, current);
        }
        String now = Times.now();
        versions.insert(noteId, current.version(), current.title(), current.content(), now, userId);
        notes.updateContent(spaceId, noteId, target.title(), target.content(),
                Excerpt.of(target.content()), searchBlob(target.title(), target.content()),
                current.version() + 1, now);
        links.rebuild(spaceId, noteId, target.content());
        links.backfillDangling(spaceId, noteId, target.title());
        // 回滚改的是正文，记一次 edit（restore 这个 action 留给回收站恢复，见 API.md §9）
        activities.record(userId, noteId, ACTION_EDIT);
        return detail(spaceId, noteId);
    }

    // ---------------------------------------------------------------- 内部

    private long resolveTagId(long spaceId, String name) {
        return tags.findByName(spaceId, name).map(TagRef::id).orElseGet(() -> {
            try {
                return tags.insert(spaceId, name, TagRepository.DEFAULT_COLOR);
            } catch (DuplicateKeyException concurrent) {
                // 并发设置同名标签：另一个事务先插入了，直接复用
                return tags.findByName(spaceId, name)
                        .map(TagRef::id)
                        .orElseThrow(() -> concurrent);
            }
        });
    }

    private void requireFolder(long spaceId, Long folderId) {
        if (folderId != null) {
            folders.findAlive(spaceId, folderId).orElseThrow(() -> ApiException.notFound("目录不存在"));
        }
    }

    private static String normalizedTitle(String raw) {
        String title = raw == null ? "" : raw.trim();
        if (title.length() > MAX_TITLE_LENGTH) {
            throw ApiException.validation("标题最长 " + MAX_TITLE_LENGTH + " 字", "title");
        }
        return title;
    }

    /**
     * 搜索索引文本（EDITOR-FORMAT §8）：标题 + 正文**先剥离内联 HTML 标签**再归一化。
     * 否则 {@code span}/{@code color}/{@code style}/{@code mark} 会进全文索引；
     * 剥离规则与摘要共用同一份实现（{@link Excerpt#stripTags}）。
     */
    private static String searchBlob(String title, String content) {
        return SearchText.normalize(Excerpt.stripTags(title + " " + content));
    }

    /** 正文按 UTF-8 字节数校验上限（中文一字约 3 字节，只看 length 会漏）。 */
    private static String validatedContent(String content) {
        if (content.getBytes(StandardCharsets.UTF_8).length > MAX_CONTENT_BYTES) {
            throw ApiException.validation("正文不能超过 2 MB", "content");
        }
        return content;
    }

    private NoteDetail toDetail(long spaceId, NoteRow row) {
        return new NoteDetail(row.id(), row.folderId(), row.title(), row.content(), row.excerpt(),
                row.favorite(), row.pinned(), row.sortOrder(), row.version(),
                tags.findByNote(spaceId, row.id()), links.countBacklinks(spaceId, row.id()),
                row.createdAt(), row.updatedAt(), com.kb.digest.DigestExtractor.extract(row.content()));
    }

    /** 标签一次批量取回，避免列表页 N+1（契约 §4 的性能要求）。 */
    private List<NoteListItem> items(long spaceId, List<NoteRow> rows) {
        Map<Long, List<TagRef>> tagsByNote =
                tags.findByNotes(spaceId, rows.stream().map(NoteRow::id).toList());
        return rows.stream()
                .map(row -> new NoteListItem(row.id(), row.folderId(), row.title(), row.excerpt(),
                        row.favorite(), row.pinned(), row.sortOrder(), row.version(),
                        tagsByNote.getOrDefault(row.id(), List.of()), row.createdAt(), row.updatedAt()))
                .toList();
    }
}

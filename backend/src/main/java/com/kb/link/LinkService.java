package com.kb.link;

import com.kb.common.ApiException;
import com.kb.common.Times;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** API.md §4 双向链接。出链在每次保存正文时全量重建（先删后插）。 */
@Service
public class LinkService {

    /** 反链上下文片段在引用两侧各取多少字符。 */
    private static final int CONTEXT_RADIUS = 60;

    private final LinkRepository links;

    public LinkService(LinkRepository links) {
        this.links = links;
    }

    /**
     * 全量重建某笔记的出链：删旧行 → 重新解析 {@code [[标题]]} → 解析得到的写 target_note_id。
     * 调用方必须已确认该笔记属于此空间。
     */
    @Transactional
    public void rebuild(long spaceId, long sourceNoteId, String content) {
        links.deleteBySource(sourceNoteId);
        String now = Times.now();
        for (String target : LinkParser.parseTargets(content)) {
            links.insert(spaceId, sourceNoteId, target, links.resolveTitle(spaceId, target), now);
        }
    }

    /** 笔记新建/改名后，补齐此前悬空的链接。 */
    public void backfillDangling(long spaceId, long noteId, String title) {
        links.backfillDangling(spaceId, noteId, title);
    }

    public long countBacklinks(long spaceId, long noteId) {
        return links.countBacklinks(spaceId, noteId);
    }

    /**
     * 出链。同名多篇时解析规则是**确定**的：取同标题里 id 最小的那一篇（见
     * {@link LinkRepository#resolveTitle}），并在响应里把歧义标出来（candidates/ambiguous）。
     */
    public LinkView outlinks(long spaceId, long sourceNoteId) {
        requireNote(spaceId, sourceNoteId);
        Map<String, Integer> candidates = links.candidateCounts(spaceId, sourceNoteId);
        List<ResolvedLink> resolved = new ArrayList<>();
        List<String> dangling = new ArrayList<>();
        List<String> ambiguousTitles = new ArrayList<>();
        for (LinkRepository.OutlinkRow row : links.outlinks(spaceId, sourceNoteId)) {
            int candidateCount = candidates.getOrDefault(row.targetTitle(), 0);
            boolean ambiguous = candidateCount > 1;
            if (ambiguous && !ambiguousTitles.contains(row.targetTitle())) {
                ambiguousTitles.add(row.targetTitle());
            }
            if (row.aliveNoteId() == null) {
                // 目标未创建，或已被软删除（契约 §4.1：软删目标退化为 dangling）
                dangling.add(row.targetTitle());
            } else {
                resolved.add(new ResolvedLink(row.aliveNoteId(), row.aliveTitle(), row.aliveFolderId(),
                        candidateCount, ambiguous));
            }
        }
        return new LinkView(resolved, dangling, ambiguousTitles);
    }

    public BacklinkView backlinks(long spaceId, long targetNoteId) {
        requireNote(spaceId, targetNoteId);
        Map<Long, BacklinkItem> items = new LinkedHashMap<>();
        for (LinkRepository.BacklinkRow row : links.backlinks(spaceId, targetNoteId)) {
            items.putIfAbsent(row.sourceNoteId(), new BacklinkItem(row.sourceNoteId(), row.sourceTitle(),
                    contextSnippet(row.sourceContent(), row.targetTitle())));
        }
        return new BacklinkView(List.copyOf(items.values()));
    }

    private void requireNote(long spaceId, long noteId) {
        if (!links.noteExists(spaceId, noteId)) {
            throw ApiException.notFound("笔记不存在");
        }
    }

    /** 引用出现位置附近的片段，够前端展示“是谁在什么上下文里引用了我”。 */
    static String contextSnippet(String content, String targetTitle) {
        if (content == null || content.isEmpty()) {
            return "";
        }
        int start = 0;
        int end = Math.min(content.length(), CONTEXT_RADIUS * 2);
        int index = indexOfIgnoreCase(content, "[[" + targetTitle + "]]");
        if (index >= 0) {
            start = Math.max(0, index - CONTEXT_RADIUS);
            end = Math.min(content.length(), index + targetTitle.length() + 4 + CONTEXT_RADIUS);
        }
        String window = content.substring(start, end)
                .replace("`", "")
                .replaceAll("<[^>]{1,200}>", " ")
                .replaceAll("\\*+", "")
                .replaceAll("\\s+", " ")
                .trim();
        return (start > 0 ? "…" : "") + window + (end < content.length() ? "…" : "");
    }

    private static int indexOfIgnoreCase(String text, String needle) {
        int last = text.length() - needle.length();
        for (int i = 0; i <= last; i++) {
            if (text.regionMatches(true, i, needle, 0, needle.length())) {
                return i;
            }
        }
        return -1;
    }
}

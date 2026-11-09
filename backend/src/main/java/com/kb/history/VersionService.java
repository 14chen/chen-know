package com.kb.history;

import com.kb.common.ApiException;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * API.md §4 历史版本（只读）。
 *
 * <p>回滚是**写正文**的操作（要重算 excerpt/search_blob 并重建 links），
 * 因此落在 {@code com.kb.note.NoteService#restore}，端点也挂在笔记控制器上，
 * 避免 note ↔ history 两个包互相依赖。
 */
@Service
public class VersionService {

    private final VersionRepository versions;

    public VersionService(VersionRepository versions) {
        this.versions = versions;
    }

    public List<VersionSummary> list(long spaceId, long noteId) {
        requireNote(spaceId, noteId);
        return VersionSummary.of(versions.listHistory(noteId));
    }

    /** 支持查当前版本号（内容不在 note_versions 里，回落到 notes）。 */
    public VersionDetail get(long spaceId, long noteId, int version) {
        requireNote(spaceId, noteId);
        return versions.resolve(spaceId, noteId, version)
                .map(VersionDetail::of)
                .orElseThrow(() -> ApiException.notFound("版本不存在"));
    }

    private void requireNote(long spaceId, long noteId) {
        if (!versions.noteExists(spaceId, noteId)) {
            throw ApiException.notFound("笔记不存在");
        }
    }
}

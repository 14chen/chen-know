package com.kb.note;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.kb.digest.Digest;
import com.kb.tag.TagRef;
import java.util.List;

/**
 * GET /api/notes/{id} 详情（API.md §4）：含 content、tags 与 backlinkCount。
 *
 * <p>{@code digest} 是**计算字段**（不落库、不改正文）：正文 ≥800 字才给「速览（自动提取）」，
 * 短文本为 {@code null}。
 */
public record NoteDetail(long id, Long folderId, String title, String content, String excerpt,
        @JsonProperty("isFavorite") boolean isFavorite,
        @JsonProperty("isPinned") boolean isPinned,
        int sortOrder, int version, List<TagRef> tags, long backlinkCount,
        String createdAt, String updatedAt, Digest digest) {

    /** 不带速览的构造（列表/新建等场景）。 */
    public NoteDetail(long id, Long folderId, String title, String content, String excerpt,
            boolean isFavorite, boolean isPinned, int sortOrder, int version, List<TagRef> tags,
            long backlinkCount, String createdAt, String updatedAt) {
        this(id, folderId, title, content, excerpt, isFavorite, isPinned, sortOrder, version, tags,
                backlinkCount, createdAt, updatedAt, null);
    }
}

package com.kb.note;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.kb.tag.TagRef;
import java.util.List;

/**
 * GET /api/notes 列表项（API.md §4）：**不含 content**，含 tags 与 excerpt。
 * {@code isFavorite}/{@code isPinned} 显式声明 JSON 名，避免 is 前缀在 bean 命名下被改写。
 */
public record NoteListItem(long id, Long folderId, String title, String excerpt,
        @JsonProperty("isFavorite") boolean isFavorite,
        @JsonProperty("isPinned") boolean isPinned,
        int sortOrder, int version, List<TagRef> tags,
        String createdAt, String updatedAt) {
}

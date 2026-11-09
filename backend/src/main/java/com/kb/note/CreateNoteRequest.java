package com.kb.note;

import jakarta.validation.constraints.Size;

/** POST /api/notes 请求体（API.md §4）。{@code folderId} 为 null 表示未分类。 */
public record CreateNoteRequest(
        Long folderId,

        @Size(max = 512, message = "标题最长 512 字")
        String title,

        String content) {
}

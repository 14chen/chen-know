package com.kb.note;

/** notes 表的一行（含正文与检索列，供服务层合并更新用）。 */
public record NoteRow(long id, long spaceId, Long folderId, String title, String content, String excerpt,
        String searchBlob, boolean favorite, boolean pinned, int sortOrder, int version,
        String createdAt, String updatedAt) {
}

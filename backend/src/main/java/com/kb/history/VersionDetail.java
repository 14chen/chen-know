package com.kb.history;

/** API.md §4：{@code GET /api/notes/{id}/versions/{version}} 的全文。 */
public record VersionDetail(long noteId, int version, String title, String content, int size,
        String createdAt, Long createdBy) {

    public static VersionDetail of(VersionRow row) {
        return new VersionDetail(row.noteId(), row.version(), row.title(), row.content(),
                row.content().length(), row.createdAt(), row.createdBy());
    }
}

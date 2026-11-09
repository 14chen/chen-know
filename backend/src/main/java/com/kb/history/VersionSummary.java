package com.kb.history;

import java.util.List;

/** API.md §4：{@code GET /api/notes/{id}/versions} 元素（倒序，含 version/createdAt/size）。 */
public record VersionSummary(long version, String title, int size, String createdAt, Long createdBy) {

    public static List<VersionSummary> of(List<VersionRow> rows) {
        return rows.stream()
                .map(row -> new VersionSummary(row.version(), row.title(), row.content().length(),
                        row.createdAt(), row.createdBy()))
                .toList();
    }
}

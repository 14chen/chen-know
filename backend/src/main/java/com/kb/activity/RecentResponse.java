package com.kb.activity;

import java.util.List;

/** API.md §4.2：{@code GET /api/recent} 的信封（items 内按 viewedAt 倒序）。 */
public record RecentResponse(List<RecentNoteItem> items) {
}

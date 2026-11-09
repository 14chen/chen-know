package com.kb.activity;

/**
 * API.md §4.2 最近浏览项。字段名已冻结：{@code noteId/title/folderId/excerpt/viewedAt}，
 * 不接受 {@code visitedAt} / {@code lastViewedAt} 等别名。
 */
public record RecentNoteItem(long noteId, String title, Long folderId, String excerpt, String viewedAt) {
}

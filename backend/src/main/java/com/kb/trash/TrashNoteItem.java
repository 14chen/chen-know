package com.kb.trash;

/**
 * 回收站里的笔记条目（API.md §8.1）。
 * {@code folderName} 为所属目录名，未分类时为 {@code null}（字段本体必须存在）。
 */
public record TrashNoteItem(long id, String title, Long folderId, String folderName, String excerpt,
        String deletedAt) {
}

package com.kb.search;

/**
 * 搜索结果项（API.md §5 + 增强）。
 *
 * @param highlight 标题/正文的 {@code <em>} 高亮（既有字段，保持不变）
 * @param snippet 命中的上下文片段：纯文本 + markdown 粗体 {@code **词**}，只在正文真有命中时才有值
 */
public record SearchHit(long noteId, String title, String highlight, double score, Long folderId,
        String updatedAt, String snippet) {

    public SearchHit(long noteId, String title, String highlight, double score, Long folderId, String updatedAt) {
        this(noteId, title, highlight, score, folderId, updatedAt, null);
    }
}

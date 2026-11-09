package com.kb.search;

/**
 * 搜索联想词（GET /api/search/suggest）。
 *
 * @param kind {@code tag}（标签名包含 q）或 {@code title}（笔记标题包含 q）
 */
public record SuggestItem(String text, String kind) {
}
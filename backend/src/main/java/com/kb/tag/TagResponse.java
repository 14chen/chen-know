package com.kb.tag;

/** API.md §6 {{@code GET /api/tags}} 的数组元素：{@code count} 为该标签下未删除笔记数。 */
public record TagResponse(long id, String name, String color, long count) {
}

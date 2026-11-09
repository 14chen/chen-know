package com.kb.tag;

/** 标签轻量引用：嵌入笔记列表项 / 详情的 {@code tags} 字段（API.md §4）。 */
public record TagRef(long id, String name, String color) {
}

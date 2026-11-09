package com.kb.link;

/** API.md §4：反链条目，{@code excerpt} 是包含该 {@code [[引用]]} 的上下文片段。 */
public record BacklinkItem(long noteId, String title, String excerpt) {
}

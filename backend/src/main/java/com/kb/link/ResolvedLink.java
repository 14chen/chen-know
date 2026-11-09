package com.kb.link;

/**
 * API.md §4.1：{@code resolved} 元素；目标笔记已被软删除时不得出现在这里，应退化为 dangling。
 *
 * <p>同名笔记（同一空间里多篇标题相同）会让「按标题引用」产生歧义：链接只挂到 id 最小的那一篇。
 * 为此追加两个可观测字段（既有字段的类型与含义不变）：
 * <ul>
 *   <li>{@code candidates} —— 该标题当前有几篇存活笔记（0/1/n）</li>
 *   <li>{@code ambiguous} —— {@code candidates > 1}，前端可据此提示"同名笔记存在歧义"</li>
 * </ul>
 */
public record ResolvedLink(long noteId, String title, Long folderId, int candidates, boolean ambiguous) {
}

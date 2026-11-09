package com.kb.link;

import java.util.List;

/**
 * API.md §4.1：{@code {resolved: [...], dangling: ["尚未创建的标题"]}}，dangling 是纯字符串数组。
 *
 * <p>追加字段 {@code ambiguousTitles}：本次出链中"同名多篇"的标题集合（升序、去重）。
 * 既有字段 {@code resolved} / {@code dangling} 的类型与含义不变。
 */
public record LinkView(List<ResolvedLink> resolved, List<String> dangling, List<String> ambiguousTitles) {
}

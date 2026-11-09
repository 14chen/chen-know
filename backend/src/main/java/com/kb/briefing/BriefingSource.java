package com.kb.briefing;

/**
 * BRIEFING.md §1：一个信息源的静态定义（id/名称/URL/形态/分组）。
 *
 * @param kind {@code RSS} / {@code HTML} / {@code JSON}
 * @param category 简报里的分组标题（§4，顺序固定）
 */
public record BriefingSource(String id, String name, String url, String kind, String category) {
}

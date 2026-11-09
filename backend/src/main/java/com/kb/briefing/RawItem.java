package com.kb.briefing;

/**
 * BRIEFING.md §5：抓取器输出的原始条目（渲染前的形态）。
 *
 * @param score 仅 Hacker News 这类有分数的源会填，其余为 {@code null}
 */
public record RawItem(String title, String url, String summary, String source, Integer score,
        String publishedAt) {
}

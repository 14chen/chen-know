package com.kb.briefing;

/**
 * BRIEFING.md §5：抓取器输出的原始条目（渲染前的形态）。
 *
 * @param score 仅 Hacker News 这类有分数的源会填，其余为 {@code null}
 * @param comments HN 的评论数（真实互动信号），其余源为 {@code null}
 * @param topComment HN 高赞原话，其余源为 {@code null}（预留给网页视图引用行）
 */
public record RawItem(String title, String url, String summary, String source, Integer score,
        String publishedAt, Integer comments, String topComment) {

    /** 兼容只有分数的调用（绝大多数源）。 */
    public RawItem(String title, String url, String summary, String source, Integer score,
            String publishedAt) {
        this(title, url, summary, source, score, publishedAt, null, null);
    }

    /** 兼容带评论数、还没有原话的调用。 */
    public RawItem(String title, String url, String summary, String source, Integer score,
            String publishedAt, Integer comments) {
        this(title, url, summary, source, score, publishedAt, comments, null);
    }
}

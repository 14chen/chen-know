package com.kb.briefing;

/**
 * 真实互动量信号（借鉴 last30days 的核心主张：用「多少人真的在意」而非源的身份判断重要性）。
 *
 * <p>全部来自原始数据，<b>不含主观源权重</b>：
 * <ul>
 *   <li>{@code score}：HN points / GitHub weekly stars</li>
 *   <li>{@code comments}：HN 评论数（讨论比点赞稀缺，权重 x2）</li>
 *   <li>{@code corroboration}：跨源印证数（同一事件被几个独立来源报道）</li>
 * </ul>
 * 只用于网页视图排序与徽标，<b>不改 note 正文</b>。
 */
public record Engagement(int score, int comments, int corroboration) {

    public static final Engagement NONE = new Engagement(0, 0, 0);

    /** 评论权重是点赞的 2 倍；从第 2 个印证源起每个 +50。 */
    static final int COMMENT_WEIGHT = 2;
    static final int CORROBORATION_BONUS = 50;

    public Engagement {
        score = Math.max(0, score);
        comments = Math.max(0, comments);
        corroboration = Math.max(0, corroboration);
    }

    /** 用于排序的热度权重。 */
    public int weight() {
        return score + comments * COMMENT_WEIGHT
                + Math.max(0, corroboration - 1) * CORROBORATION_BONUS;
    }

    /** 1..3 档，供网页视图的「热度」徽标使用（不改 note 的五段式）。 */
    public int level() {
        int weight = weight();
        if (weight >= 300) {
            return 3;
        }
        return weight >= 100 ? 2 : 1;
    }
}

package com.kb.briefing;

import java.time.Duration;
import java.util.List;
import java.util.Set;

/**
 * BRIEFING.md §1 的源清单 —— 唯一真源。URL 全部由 Lead 实测，不要凭记忆改。
 *
 * <p>已实测不可用（不要再加回来）：reddit 全变体、news.google.com/rss、importai.substack.com、
 * anthropic.com/rss.xml、bing news 的 format=rss、deeplearning.ai 的 batch feed。
 */
public final class BriefingSources {

    /** §4 的分组标题，顺序即渲染顺序。 */
    public static final String CAT_LEAD = "国外 · 一手";
    public static final String CAT_NEWS = "国外 · 快讯";
    public static final String CAT_CN = "国内";
    public static final String CAT_RESEARCH = "研究";

    public static final List<String> CATEGORIES = List.of(CAT_LEAD, CAT_NEWS, CAT_CN, CAT_RESEARCH);

    /** 抓取顺序即渲染顺序；改这里就等于改简报的章节顺序。 */
    public static final List<BriefingSource> ALL = List.of(
            new BriefingSource("openai", "OpenAI", "https://openai.com/news/rss.xml", "RSS", CAT_LEAD),
            new BriefingSource("deepmind", "Google DeepMind", "https://deepmind.google/blog/rss.xml", "RSS", CAT_LEAD),
            new BriefingSource("anthropic", "Anthropic", "https://www.anthropic.com/news", "HTML", CAT_LEAD),
            new BriefingSource("techmeme", "Techmeme", "https://www.techmeme.com/feed.xml", "RSS", CAT_NEWS),
            new BriefingSource("hackernews", "Hacker News",
                    "https://hn.algolia.com/api/v1/search?query=AI&tags=story", "JSON", CAT_NEWS),
            new BriefingSource("qbitai", "量子位", "https://www.qbitai.com/feed", "RSS", CAT_CN),
            new BriefingSource("jiqizhixin", "机器之心", "https://www.jiqizhixin.com/", "HTML", CAT_CN),
            new BriefingSource("arxiv", "arXiv cs.AI", "https://arxiv.org/list/cs.AI/recent", "HTML", CAT_RESEARCH),
            new BriefingSource("huggingface", "Hugging Face", "https://huggingface.co/blog/feed.xml", "RSS", CAT_RESEARCH),
            new BriefingSource("importai", "Import AI", "https://www.importai.net/feed", "RSS", CAT_RESEARCH));

    /**
     * 慢源：列表页大、响应高延迟（arXiv 实测 curl 1.4~7s，JVM 偶尔 20s+）。
     * 给它们更宽松的单次超时与单源预算。
     */
    private static final Set<String> SLOW = Set.of("arxiv");

    /** 常态源单次尝试超时（3 次尝试 + 退避 ≈ 38s，仍在 40s 预算内）。 */
    static final Duration ATTEMPT_TIMEOUT = Duration.ofSeconds(12);
    /** 慢源单次尝试超时（3 次尝试 + 退避 ≈ 77s，仍在 70s 预算附近）。 */
    static final Duration SLOW_ATTEMPT_TIMEOUT = Duration.ofSeconds(25);
    /**
     * 常态源总预算：40s。所有源并发跑，所以这个值直接决定「最坏情况」的整体耗时
     * （40s 抓取 + 25s 富化 ≈ 65s，仍在 90s 目标内）；健康时耗时只有几秒。
     */
    static final Duration BUDGET = Duration.ofSeconds(40);
    /** 慢源总预算：90s（35s × 2 次 + 退避，够 arXiv 抖动用）。 */
    static final Duration SLOW_BUDGET = Duration.ofSeconds(70);

    private BriefingSources() {
    }

    public static boolean isSlow(String id) {
        return id != null && SLOW.contains(id);
    }

    /** 抓这个源时单次尝试给多久。 */
    public static Duration attemptTimeout(String id) {
        return isSlow(id) ? SLOW_ATTEMPT_TIMEOUT : ATTEMPT_TIMEOUT;
    }

    /** 抓这个源最多等多久（含重试与退避）。 */
    public static Duration budget(String id) {
        return isSlow(id) ? SLOW_BUDGET : BUDGET;
    }

    public static BriefingSource byId(String id) {
        return ALL.stream().filter(source -> source.id().equals(id)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("未知简报源: " + id));
    }
}

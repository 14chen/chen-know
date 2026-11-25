package com.kb.briefing;

import java.util.List;

/** 简报条目明细：给网页视图的 Top5 / 主题 / 详情抽屉使用，note 正文格式不受影响。 */
public record BriefingItem(long runId, String url, String title, String summary, String source, String theme,
        int qualityScore, boolean accepted, int rank, List<String> keyPoints, String whyItMatters,
        List<String> relatedTitles, int engagement, int engagementLevel, int corroboration,
        List<String> sourceLinks, String topQuote) {

    /** 兼容还没有互动量/聚簇的老调用。 */
    public BriefingItem(long runId, String url, String title, String summary, String source, String theme,
            int qualityScore, boolean accepted, int rank, List<String> keyPoints, String whyItMatters,
            List<String> relatedTitles) {
        this(runId, url, title, summary, source, theme, qualityScore, accepted, rank, keyPoints, whyItMatters,
                relatedTitles, 0, 1, 1, List.of(), null);
    }
}

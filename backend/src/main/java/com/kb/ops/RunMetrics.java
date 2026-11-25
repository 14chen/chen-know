package com.kb.ops;

/** 一次 run 的指标快照；对应 run_metrics 表一行。 */
public record RunMetrics(String module, long runId, String status, long totalMs, long stageFetchMs,
        long stageEnrichMs, long stageQualityAiMs, long stageRenderMs, int itemsFetched, int itemsKept,
        int qualityDowngraded, int aiCalls, long aiPromptTokens, long aiCompletionTokens, double estimatedCost,
        String createdAt) {
}

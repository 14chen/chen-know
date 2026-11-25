package com.kb.briefing;

import com.kb.common.Times;
import java.util.List;

/** 单源健康快照；state 由冷却截止时间和静态 skip 标记推导。 */
public record SourceHealth(String sourceId, String name, int successCount, int failureCount,
        int consecutiveFailures, String lastSuccessAt, String lastFailureAt, long lastLatencyMs,
        long p95LatencyMs, String cooldownUntil, boolean staticallySkipped) {

    @com.fasterxml.jackson.annotation.JsonProperty
    public String state() {
        if (staticallySkipped) return "skipped";
        if (cooldownUntil != null && cooldownUntil.compareTo(Times.now()) > 0) return "cooling";
        if (consecutiveFailures > 0) return "degraded";
        return "ok";
    }

    /** 前端与正文展示用：冷却到点后给出具体恢复时刻。 */
    @com.fasterxml.jackson.annotation.JsonProperty
    public String statusMessage() {
        return switch (state()) {
            case "cooling" -> "冷却中，预计 " + cooldownUntil.substring(11, 16) + " UTC 恢复";
            case "skipped" -> "已知不可达（Cloudflare 反爬，本次已跳过）";
            case "degraded" -> "最近 " + consecutiveFailures + " 次未取到";
            default -> successCount > 0 ? successCount + " 条" : "—";
        };
    }

    public static SourceHealth empty(String sourceId, String name, boolean skipped) {
        return new SourceHealth(sourceId, name, 0, 0, 0, null, null, 0, 0, null, skipped);
    }
}

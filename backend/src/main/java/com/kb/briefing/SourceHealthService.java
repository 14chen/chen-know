package com.kb.briefing;

import java.util.List;
import org.springframework.stereotype.Service;

/** 源健康编排：抓取前判冷却，抓取后记录结果，供 ops 查询。 */
@Service
public class SourceHealthService {

    private final SourceHealthRepository repository;
    private final BriefingProperties properties;

    public SourceHealthService(SourceHealthRepository repository, BriefingProperties properties) {
        this.repository = repository;
        this.properties = properties;
    }

    /** 冷却中的源返回提示文案；未冷却返回 null。静态 skip 由调用方单独处理。 */
    public String coolingReason(long spaceId, String sourceId) {
        String until = repository.cooldownUntil(spaceId, "briefing", sourceId);
        return until == null ? null : "冷却中，预计 " + until.substring(11, 16) + " UTC 恢复";
    }

    public void record(long spaceId, String sourceId, boolean ok, long latencyMs) {
        try {
            repository.record(spaceId, "briefing", sourceId, ok, latencyMs);
        } catch (RuntimeException e) {
            // 健康记录是旁路，绝不影响抓取结果
        }
    }

    public List<SourceHealth> list(long spaceId) {
        List<SourceHealth> result = repository.all(spaceId, "briefing");
        return result.stream().map(health -> {
            if (!properties.isSkipped(health.sourceId())) return health;
            return new SourceHealth(health.sourceId(), health.name(), health.successCount(), health.failureCount(),
                    health.consecutiveFailures(), health.lastSuccessAt(), health.lastFailureAt(),
                    health.lastLatencyMs(), health.p95LatencyMs(), health.cooldownUntil(), true);
        }).toList();
    }
}

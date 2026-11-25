package com.kb.ops;

import com.kb.analysis.AnalysisProperties;
import com.kb.analysis.AnalysisUsage;
import com.kb.briefing.MiniJson;
import com.kb.common.Times;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** 指标记录与聚合。任何指标异常都不影响业务 run（由调用方兜底）。 */
@Service
public class RunMetricsService {

    public record Summary(int runs, double successRate, long p50Ms, long p95Ms, double avgItems, int aiCalls,
            long tokens, double estimatedCost, List<SourceHealth> sourceHealth) {
    }

    public record SourceHealth(String source, int ok, int failed) {
    }

    private final RunMetricsRepository repository;
    private final AnalysisProperties aiProperties;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public RunMetricsService(RunMetricsRepository repository, AnalysisProperties aiProperties,
            org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.repository = repository;
        this.aiProperties = aiProperties;
        this.jdbc = jdbc;
    }

    public double estimatedCost(AnalysisUsage usage) {
        if (usage == null) return 0;
        return usage.promptTokens() / 1_000_000.0 * aiProperties.getPriceInputPer1m()
                + usage.completionTokens() / 1_000_000.0 * aiProperties.getPriceOutputPer1m();
    }

    public void save(RunMetrics metrics, long spaceId) {
        repository.save(metrics, spaceId);
    }

    public List<RunMetrics> list(long spaceId, String module, int limit, boolean allSpaces) {
        return repository.list(spaceId, module, limit, allSpaces);
    }

    public Summary summary(long spaceId, String module, int days) {
        String after = Times.format(Instant.now().minus(Duration.ofDays(Math.max(1, Math.min(90, days)))));
        // spaceId = 0 表示管理员全局汇总
        List<RunMetrics> rows = spaceId == 0 ? repository.sinceAll(module, after)
                : repository.since(spaceId, module, after);
        if (rows.isEmpty()) {
            return new Summary(0, 0, 0, 0, 0, 0, 0, 0, List.of());
        }
        long successful = rows.stream()
                .filter(row -> "success".equals(row.status()) || "partial".equals(row.status())).count();
        List<Long> durations = rows.stream().map(RunMetrics::totalMs).sorted().toList();
        long p50 = percentile(durations, 0.50);
        long p95 = percentile(durations, 0.95);
        double avgItems = rows.stream().mapToInt(RunMetrics::itemsKept).average().orElse(0);
        int calls = rows.stream().mapToInt(RunMetrics::aiCalls).sum();
        long tokens = rows.stream().mapToLong(row -> row.aiPromptTokens() + row.aiCompletionTokens()).sum();
        double cost = rows.stream().mapToDouble(RunMetrics::estimatedCost).sum();
        return new Summary(rows.size(), (double) successful / rows.size(), p50, p95, avgItems, calls, tokens, cost,
                sourceHealth(spaceId, module, after));
    }

    private static long percentile(List<Long> sorted, double fraction) {
        if (sorted.isEmpty()) return 0;
        int index = (int) Math.min(sorted.size() - 1, Math.floor(fraction * sorted.size()));
        return sorted.get(index);
    }

    /** 简报从 source_report 聚合逐源成功率；周报目前只有整体 error，暂不逐源展开。 */
    private List<SourceHealth> sourceHealth(long spaceId, String module, String after) {
        if (!"briefing".equals(module)) return List.of();
        Map<String, int[]> counts = new LinkedHashMap<>();
        String sql = "SELECT source_report FROM briefing_runs WHERE started_at >= ?"
                + (spaceId == 0 ? "" : " AND space_id = ?")
                + " AND status IN ('success','partial')";
        jdbc.query(sql,
                rs -> {
                    List<Object> entries = MiniJson.asArray(MiniJson.parse(rs.getString("source_report")));
                    for (Object entry : entries) {
                        Map<String, Object> item = MiniJson.asObject(entry);
                        String source = MiniJson.string(item.get("source"));
                        if (source == null || MiniJson.integer(item.get("skipped")) != null
                                && MiniJson.integer(item.get("skipped")) != 0) continue;
                        int[] counter = counts.computeIfAbsent(source, key -> new int[2]);
                        if (item.get("ok") instanceof Boolean ok && ok) counter[0]++;
                        else counter[1]++;
                    }
                }, spaceId == 0 ? new Object[] { after } : new Object[] { after, spaceId });
        List<SourceHealth> result = new ArrayList<>();
        counts.forEach((source, counter) -> result.add(new SourceHealth(source, counter[0], counter[1])));
        result.sort(Comparator.comparingInt((SourceHealth h) -> h.failed()).reversed());
        return result;
    }
}

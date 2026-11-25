package com.kb.briefing;

import com.kb.common.Times;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** source_health 读写；每次抓取结果读-改-写，单源串行，无需分布式锁。 */
@Repository
public class SourceHealthRepository {

    private final JdbcTemplate jdbc;

    public SourceHealthRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<SourceHealth> find(long spaceId, String module, String sourceId) {
        return jdbc.query("SELECT * FROM source_health WHERE space_id = ? AND module = ? AND source_id = ?",
                (rs, n) -> {
                    String name = sourceId.startsWith("hn") || sourceId.contains("hacker")
                            ? "Hacker News" : BriefingSources.byId(sourceId) == null
                                    ? sourceId : BriefingSources.byId(sourceId).name();
                    return new SourceHealth(sourceId, name, rs.getInt("success_count"), rs.getInt("failure_count"),
                            rs.getInt("consecutive_failures"), rs.getString("last_success_at"),
                            rs.getString("last_failure_at"), rs.getLong("last_latency_ms"),
                            percentile(MiniJson.asArray(MiniJson.parse(rs.getString("latency_window")))),
                            rs.getString("cooldown_until"), false);
                }, spaceId, module, sourceId).stream().findFirst();
    }

    public List<SourceHealth> all(long spaceId, String module) {
        List<SourceHealth> result = new ArrayList<>();
        for (BriefingSource source : BriefingSources.ALL) {
            result.add(find(spaceId, module, source.id())
                    .orElseGet(() -> SourceHealth.empty(source.id(), source.name(), false)));
        }
        return result;
    }

    /** ok=true 清零连续失败；ok=false 累计，达到 5 次写 30 分钟冷却。 */
    public void record(long spaceId, String module, String sourceId, boolean ok, long latencyMs) {
        SourceHealth current = find(spaceId, module, sourceId)
                .orElseGet(() -> SourceHealth.empty(sourceId, sourceId, false));
        int consecutive = ok ? 0 : current.consecutiveFailures() + 1;
        String cooldown = ok || consecutive < 5 ? null
                : Times.format(java.time.Instant.now().plus(java.time.Duration.ofMinutes(30)));
        List<Object> window = new ArrayList<>(MiniJson.asArray(MiniJson.parse(latencyWindow(spaceId, module, sourceId))));
        window.add(latencyMs);
        if (window.size() > 20) window = new ArrayList<>(window.subList(window.size() - 20, window.size()));
        String now = Times.now();
        jdbc.update("INSERT INTO source_health (space_id, module, source_id, success_count, failure_count,"
                        + " consecutive_failures, last_success_at, last_failure_at, last_latency_ms,"
                        + " latency_window, cooldown_until, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                        + " ON CONFLICT(space_id, module, source_id) DO UPDATE SET"
                        + " success_count = excluded.success_count, failure_count = excluded.failure_count,"
                        + " consecutive_failures = excluded.consecutive_failures,"
                        + " last_success_at = excluded.last_success_at, last_failure_at = excluded.last_failure_at,"
                        + " last_latency_ms = excluded.last_latency_ms, latency_window = excluded.latency_window,"
                        + " cooldown_until = excluded.cooldown_until, updated_at = excluded.updated_at",
                spaceId, module, sourceId, current.successCount() + (ok ? 1 : 0),
                current.failureCount() + (ok ? 0 : 1), consecutive, ok ? now : current.lastSuccessAt(),
                ok ? current.lastFailureAt() : now, latencyMs, MiniJson.write(window), cooldown, now);
    }

    /** 冷却期内返回恢复时刻；否则 null。 */
    public String cooldownUntil(long spaceId, String module, String sourceId) {
        return find(spaceId, module, sourceId)
                .map(SourceHealth::cooldownUntil)
                .filter(value -> value != null && value.compareTo(Times.now()) > 0)
                .orElse(null);
    }

    private String latencyWindow(long spaceId, String module, String sourceId) {
        String value = jdbc.query("SELECT latency_window FROM source_health WHERE space_id = ? AND module = ?"
                + " AND source_id = ?", (rs, n) -> rs.getString("latency_window"), spaceId, module, sourceId)
                .stream().findFirst().orElse(null);
        return value == null || value.isBlank() ? "[]" : value;
    }

    private static long percentile(List<Object> values) {
        if (values.isEmpty()) return 0;
        List<Long> sorted = new ArrayList<>();
        for (Object value : values) {
            if (value instanceof Number number) sorted.add(number.longValue());
        }
        if (sorted.isEmpty()) return 0;
        sorted.sort(Long::compareTo);
        int index = (int) Math.min(sorted.size() - 1, Math.floor(0.95 * sorted.size()));
        return sorted.get(index);
    }
}

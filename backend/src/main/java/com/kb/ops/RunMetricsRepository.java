package com.kb.ops;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** run_metrics 读写；所有查询按 space_id 隔离（管理员显式 all 时不加空间条件）。 */
@Repository
public class RunMetricsRepository {

    private static final String COLUMNS = "module, run_id, status, total_ms, stage_fetch_ms, stage_enrich_ms,"
            + " stage_quality_ai_ms, stage_render_ms, items_fetched, items_kept, quality_downgraded,"
            + " ai_calls, ai_prompt_tokens, ai_completion_tokens, estimated_cost, created_at";

    private static final org.springframework.jdbc.core.RowMapper<RunMetrics> MAPPER = (rs, n) ->
            new RunMetrics(rs.getString("module"), rs.getLong("run_id"), rs.getString("status"),
                    rs.getLong("total_ms"), rs.getLong("stage_fetch_ms"), rs.getLong("stage_enrich_ms"),
                    rs.getLong("stage_quality_ai_ms"), rs.getLong("stage_render_ms"),
                    rs.getInt("items_fetched"), rs.getInt("items_kept"), rs.getInt("quality_downgraded"),
                    rs.getInt("ai_calls"), rs.getLong("ai_prompt_tokens"), rs.getLong("ai_completion_tokens"),
                    rs.getDouble("estimated_cost"), rs.getString("created_at"));

    private final JdbcTemplate jdbc;

    public RunMetricsRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void save(RunMetrics m, long spaceId) {
        jdbc.update("INSERT OR REPLACE INTO run_metrics (" + COLUMNS + ", space_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?,"
                        + " ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                m.module(), m.runId(), m.status(), m.totalMs(), m.stageFetchMs(), m.stageEnrichMs(),
                m.stageQualityAiMs(), m.stageRenderMs(), m.itemsFetched(), m.itemsKept(), m.qualityDowngraded(),
                m.aiCalls(), m.aiPromptTokens(), m.aiCompletionTokens(), m.estimatedCost(), m.createdAt(), spaceId);
    }

    public List<RunMetrics> list(long spaceId, String module, int limit, boolean allSpaces) {
        StringBuilder sql = new StringBuilder("SELECT ").append(COLUMNS).append(" FROM run_metrics WHERE 1=1");
        java.util.List<Object> args = new java.util.ArrayList<>();
        if (!allSpaces) {
            sql.append(" AND space_id = ?");
            args.add(spaceId);
        }
        if (module != null && !module.isBlank()) {
            sql.append(" AND module = ?");
            args.add(module);
        }
        sql.append(" ORDER BY created_at DESC LIMIT ?");
        args.add(Math.max(1, Math.min(200, limit)));
        return jdbc.query(sql.toString(), MAPPER, args.toArray());
    }

    /** 管理员全局汇总：不带 space_id 条件。 */
    public List<RunMetrics> sinceAll(String module, String afterIso) {
        return jdbc.query("SELECT " + COLUMNS + " FROM run_metrics WHERE created_at >= ?"
                        + (module == null || module.isBlank() ? "" : " AND module = ?") + " ORDER BY created_at DESC",
                MAPPER, module == null || module.isBlank()
                        ? new Object[] { afterIso }
                        : new Object[] { afterIso, module });
    }

    public List<RunMetrics> since(long spaceId, String module, String afterIso) {
        return jdbc.query("SELECT " + COLUMNS + " FROM run_metrics WHERE space_id = ? AND created_at >= ?"
                        + (module == null || module.isBlank() ? "" : " AND module = ?") + " ORDER BY created_at DESC",
                MAPPER, module == null || module.isBlank()
                        ? new Object[] { spaceId, afterIso }
                        : new Object[] { spaceId, afterIso, module });
    }
}

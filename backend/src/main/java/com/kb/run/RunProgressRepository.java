package com.kb.run;

import com.kb.common.Times;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 进度表读写。module 只接受白名单值，避免拼接表名被外部输入利用。 */
@Repository
public class RunProgressRepository {

    private static final Map<String, String> RUN_TABLES = Map.of(
            "briefing", "briefing_runs",
            "weekly", "weekly_runs");

    private final JdbcTemplate jdbc;

    public RunProgressRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void init(long spaceId, String module, long runId) {
        table(module);   // 白名单校验
        jdbc.update("INSERT OR REPLACE INTO run_progress (space_id, module, run_id, status, stage, done, total,"
                        + " cancelled, updated_at) VALUES (?, ?, ?, 'running', 'fetching', 0, 0, 0, ?)",
                spaceId, module, runId, Times.now());
    }

    public void stage(long spaceId, String module, long runId, String stage, int done, int total) {
        jdbc.update("UPDATE run_progress SET stage = ?, done = ?, total = ?, updated_at = ?"
                        + " WHERE space_id = ? AND module = ? AND run_id = ?",
                stage, done, total, Times.now(), spaceId, module, runId);
    }

    public void finish(long spaceId, String module, long runId, String status) {
        jdbc.update("UPDATE run_progress SET status = ?, stage = ?, updated_at = ?"
                        + " WHERE space_id = ? AND module = ? AND run_id = ?",
                status, "done".equals(status) ? "done" : status, Times.now(), spaceId, module, runId);
    }

    public void cancel(long spaceId, String module, long runId) {
        jdbc.update("UPDATE run_progress SET cancelled = 1, updated_at = ?"
                        + " WHERE space_id = ? AND module = ? AND run_id = ?",
                Times.now(), spaceId, module, runId);
    }

    public boolean isCancelled(long spaceId, String module, long runId) {
        // 同步 run 没有进度行：查不到即视为未取消，不能抛异常打断生成
        return jdbc.query("SELECT cancelled FROM run_progress WHERE space_id = ? AND module = ? AND run_id = ?",
                (rs, n) -> rs.getInt("cancelled") != 0, spaceId, module, runId)
                .stream().findFirst().orElse(Boolean.FALSE);
    }

    public java.util.Optional<RunProgress> get(long spaceId, String module, long runId) {
        String table = table(module);
        return jdbc.query("SELECT p.run_id, p.status, p.stage, p.done, p.total, p.cancelled, r.started_at,"
                        + " r.finished_at FROM run_progress p JOIN " + table + " r ON r.id = p.run_id"
                        + " AND r.space_id = p.space_id WHERE p.space_id = ? AND p.module = ? AND p.run_id = ?",
                (rs, n) -> new RunProgress(rs.getLong("run_id"), rs.getString("status"), rs.getString("stage"),
                        rs.getInt("done"), rs.getInt("total"), rs.getInt("cancelled") != 0,
                        rs.getString("started_at"), rs.getString("finished_at"),
                        RunProgress.labelFor(rs.getString("stage"))),
                spaceId, module, runId).stream().findFirst();
    }

    private static String table(String module) {
        String table = RUN_TABLES.get(module == null ? "" : module.toLowerCase());
        if (table == null) {
            throw com.kb.common.ApiException.validation("module 只支持 briefing / weekly", "module");
        }
        return table;
    }
}

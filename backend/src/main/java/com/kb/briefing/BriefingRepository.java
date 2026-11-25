package com.kb.briefing;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

/** BRIEFING.md §2/§3：{@code briefing_runs} 与 {@code briefing_seen} 的读写。 */
@Repository
public class BriefingRepository {

    private static final String COLUMNS = "id, space_id, started_at, finished_at, status, note_id,"
            + " total_items, new_items, source_report, error";

    private static final RowMapper<BriefingRun> MAPPER = (rs, rowNum) -> {
        long noteRaw = rs.getLong("note_id");
        Long noteId = rs.wasNull() ? null : noteRaw;
        return new BriefingRun(rs.getLong("id"), rs.getLong("space_id"), rs.getString("started_at"),
                rs.getString("finished_at"), rs.getString("status"), noteId, rs.getInt("total_items"),
                rs.getInt("new_items"), rs.getString("source_report"), rs.getString("error"));
    };

    private final JdbcTemplate jdbc;

    public BriefingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public long insertRun(long spaceId, String startedAt) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO briefing_runs (space_id, started_at, status) VALUES (?, ?, 'running')",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, spaceId);
            ps.setString(2, startedAt);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("插入简报运行记录后未取得主键");
        }
        return key.longValue();
    }

    public void finishRun(long runId, String finishedAt, String status, Long noteId, int totalItems,
            int newItems, String sourceReport, String error) {
        jdbc.update("UPDATE briefing_runs SET finished_at = ?, status = ?, note_id = ?, total_items = ?,"
                        + " new_items = ?, source_report = ?, error = ? WHERE id = ?",
                finishedAt, status, noteId, totalItems, newItems, sourceReport, error, runId);
    }

    /** 进程中断会留下 status=running 的僵尸行；下次运行前把老于 30 分钟的标记为 failed。 */
    public int markStaleRunningFailed(long spaceId, String startedBeforeIso, String now) {
        return jdbc.update("UPDATE briefing_runs SET status = 'failed', finished_at = ?,"
                        + " error = COALESCE(error, '上次运行未正常结束（进程中断？）')"
                        + " WHERE space_id = ? AND status = 'running' AND started_at < ?",
                now, spaceId, startedBeforeIso);
    }

    /** 今天是否已有成功/部分成功的运行（BRIEFING.md §3 + 启动补抓判断）。 */
    public boolean hasRunToday(long spaceId, String isoDay) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM briefing_runs"
                + " WHERE space_id = ? AND substr(started_at, 1, 10) = ? AND status IN ('success','partial')",
                Integer.class, spaceId, isoDay);
        return count != null && count > 0;
    }

    public List<BriefingRun> recent(long spaceId, int limit) {
        return jdbc.query("SELECT " + COLUMNS + " FROM briefing_runs WHERE space_id = ?"
                + " ORDER BY id DESC LIMIT ?", MAPPER, spaceId, Math.max(1, limit));
    }

    public Optional<BriefingRun> findById(long spaceId, long id) {
        List<BriefingRun> rows = jdbc.query("SELECT " + COLUMNS + " FROM briefing_runs"
                + " WHERE id = ? AND space_id = ?", MAPPER, id, spaceId);
        return rows.stream().findFirst();
    }

    public Set<String> seenUrls(long spaceId) {
        return new HashSet<>(jdbc.queryForList(
                "SELECT url FROM briefing_seen WHERE space_id = ?", String.class, spaceId));
    }

    /** 长期未刷新的缓存行滚动清理（保留期由 kb.briefing.cache-retention-days 控制）。 */
    public int purgeExpiredCache(long spaceId, String beforeIso) {
        return jdbc.update("DELETE FROM briefing_cache WHERE space_id = ?"
                + " AND COALESCE(updated_at, created_at) < ?", spaceId, beforeIso);
    }

    /** 去重台账只保留最近一段时间，避免无限增长（保留期由 kb.briefing.seen-retention-days 控制）。 */
    public int purgeOldSeen(long spaceId, String beforeIso) {
        return jdbc.update("DELETE FROM briefing_seen WHERE space_id = ? AND first_seen_at < ?",
                spaceId, beforeIso);
    }

    /** 只有真正写进简报的 url 才记入 seen（BRIEFING.md §3 第 4 条）。 */
    public int markSeen(long spaceId, Collection<String> urls, String now) {
        if (urls.isEmpty()) {
            return 0;
        }
        int[] inserted = jdbc.batchUpdate(
                "INSERT OR IGNORE INTO briefing_seen (space_id, url, first_seen_at) VALUES (?, ?, ?)",
                urls.stream().map(url -> new Object[] {spaceId, url, now}).toList());
        int total = 0;
        for (int count : inserted) {
            total += Math.max(count, 0);
        }
        return total;
    }
}

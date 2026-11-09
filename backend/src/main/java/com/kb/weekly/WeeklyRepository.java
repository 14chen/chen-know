package com.kb.weekly;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

/** {@code weekly_runs}：同一 ISO 周只自动跑一次的判据 + 运行历史。 */
@Repository
public class WeeklyRepository {

    private final JdbcTemplate jdbc;

    public WeeklyRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Run(long id, String isoWeek, String startedAt, String finishedAt, String status,
            int notesCreated, int notesSkipped, int githubCount, int giteeCount, String error) {
    }

    public long insert(long spaceId, String isoWeek, String startedAt) {
        // 必须用 GeneratedKeyHolder 取主键：连池里 last_insert_rowid() 可能落到另一条连接上，
        // 会拿到错的 id → finish() 更新不到自己的行，run 永远停在 running
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO weekly_runs (space_id, iso_week, started_at, status, notes_created,"
                            + " github_count, gitee_count) VALUES (?, ?, ?, 'running', 0, 0, 0)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, spaceId);
            ps.setString(2, isoWeek);
            ps.setString(3, startedAt);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("插入周报运行记录后未取得主键");
        }
        return key.longValue();
    }

    public void finish(long id, String finishedAt, String status, int notesCreated, int notesSkipped,
            int githubCount, int giteeCount, String error) {
        jdbc.update("UPDATE weekly_runs SET finished_at = ?, status = ?, notes_created = ?,"
                + " notes_skipped = ?, github_count = ?, gitee_count = ?, error = ? WHERE id = ?",
                finishedAt, status, notesCreated, notesSkipped, githubCount, giteeCount, error, id);
    }

    /** 同一个周目录里同标题的笔记（用于「同一周重复运行不生成重复笔记」）。 */
    public java.util.Optional<Long> findNoteId(long spaceId, long folderId, String title) {
        return jdbc.query("SELECT id FROM notes WHERE space_id = ? AND folder_id = ? AND title = ?"
                        + " AND deleted_at IS NULL ORDER BY id LIMIT 1",
                (rs, rowNum) -> rs.getLong("id"), spaceId, folderId, title).stream().findFirst();
    }

    /** 本周是否已经成功跑过（success / partial）。 */
    public boolean hasRunForWeek(long spaceId, String isoWeek) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM weekly_runs WHERE space_id = ?"
                + " AND iso_week = ? AND status IN ('success','partial')", Integer.class, spaceId, isoWeek);
        return count != null && count > 0;
    }

    public List<Run> recent(long spaceId, int limit) {
        return jdbc.query("SELECT id, iso_week, started_at, finished_at, status, notes_created,"
                        + " notes_skipped, github_count, gitee_count, error FROM weekly_runs WHERE space_id = ?"
                        + " ORDER BY id DESC LIMIT ?",
                (rs, rowNum) -> new Run(rs.getLong("id"), rs.getString("iso_week"),
                        rs.getString("started_at"), rs.getString("finished_at"), rs.getString("status"),
                        rs.getInt("notes_created"), rs.getInt("notes_skipped"), rs.getInt("github_count"),
                        rs.getInt("gitee_count"), rs.getString("error")),
                spaceId, limit);
    }
}

package com.kb.activity;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/** {@code activities} 表读写；统计所需的计数查询也集中在此。 */
@Repository
public class ActivityRepository {

    /**
     * GET /api/stats 需要的一组计数：一次聚合查询取回，字段与 {@code StatsResponse} 一一对应。
     *
     * @param createdByDate 最近窗口内"按创建日期分组"的笔记数（键为 yyyy-MM-dd，只含非零日期）
     */
    public record StatsAggregate(long noteCount, long folderCount, long tagCount, long attachmentCount,
            long totalAttachmentBytes, long trashCount, long updatedToday, Map<String, Long> createdByDate) {
    }

    /** 聚合查询返回的原始行：kind 决定 (a, b, c) 的含义。 */
    private record AggRow(String kind, long a, long b, long c) {
    }

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;

    public ActivityRepository(JdbcTemplate jdbc, NamedParameterJdbcTemplate namedJdbc) {
        this.jdbc = jdbc;
        this.namedJdbc = namedJdbc;
    }

    /**
     * 统计所需的全部计数，一次数据库往返取回。
     *
     * <p>为什么拼成一条 UNION ALL：本应用的 SQLite DataSource 没有连接池，每次取连接都要新建连接并
     * 下发 4 条 PRAGMA，"查询条数"本身就是固定成本；原先 8 条独立 COUNT 在 1 万篇时要 130~150ms。
     * 合并后只走一次往返，且 notes 表只扫一遍 —— 存活数 / 回收站数 / 今日更新数由同一次扫描里的
     * CASE 求和得出，dailyCreated 的按天分组也挂在同一条语句里。
     *
     * <p>各分支列固定为 (kind, a, b, c)：notes → (存活, 已删, 今日更新)；folders → (存活, 已删)；
     * attachments → (数量, 字节和)；tags → (数量)；{@code day:yyyy-MM-dd} → (当天创建数)。
     *
     * <p>daily 分支用 {@code created_at >= :from} 而不是 {@code substr(created_at,1,10) >= :from}：
     * 两者对 ISO-8601 文本等价，但范围谓词才能让 (space_id, deleted_at, created_at) 这类覆盖索引生效。
     * 实测该分支的代价全在"回表取 created_at"上（1 万篇 105ms），有覆盖索引后降到 6.5ms —— 索引本身
     * 属 db/** 的建表脚本，已作为跨流建议提出（见 notes-c.md）。
     */
    public StatsAggregate spaceStats(long spaceId, String todayIsoDate, String fromIsoDate) {
        List<AggRow> rows = namedJdbc.query("""
                SELECT kind, a, b, c FROM (
                    SELECT 'notes' AS kind,
                           SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS a,
                           SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS b,
                           SUM(CASE WHEN deleted_at IS NULL AND substr(updated_at, 1, 10) = :today
                                    THEN 1 ELSE 0 END) AS c
                    FROM notes WHERE space_id = :spaceId
                    UNION ALL
                    SELECT 'folders',
                           SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END),
                           SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END),
                           0
                    FROM folders WHERE space_id = :spaceId
                    UNION ALL
                    SELECT 'attachments', COUNT(*), COALESCE(SUM(size_bytes), 0), 0
                    FROM attachments WHERE space_id = :spaceId
                    UNION ALL
                    SELECT 'tags', COUNT(*), 0, 0
                    FROM tags WHERE space_id = :spaceId
                    UNION ALL
                    SELECT 'day:' || d, n, 0, 0 FROM (
                        SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n
                        FROM notes
                        WHERE space_id = :spaceId AND deleted_at IS NULL
                          AND created_at >= :from
                        GROUP BY d)
                )
                """, new MapSqlParameterSource()
                .addValue("spaceId", spaceId)
                .addValue("today", todayIsoDate)
                .addValue("from", fromIsoDate),
                (rs, rowNum) -> new AggRow(rs.getString(1), rs.getLong(2), rs.getLong(3), rs.getLong(4)));

        long noteCount = 0, notesTrashed = 0, updatedToday = 0;
        long folderCount = 0, foldersTrashed = 0;
        long attachmentCount = 0, attachmentBytes = 0, tagCount = 0;
        Map<String, Long> createdByDate = new HashMap<>();
        for (AggRow row : rows) {
            switch (row.kind()) {
                case "notes" -> {
                    noteCount = row.a();
                    notesTrashed = row.b();
                    updatedToday = row.c();
                }
                case "folders" -> {
                    folderCount = row.a();
                    foldersTrashed = row.b();
                }
                case "attachments" -> {
                    attachmentCount = row.a();
                    attachmentBytes = row.b();
                }
                case "tags" -> tagCount = row.a();
                default -> {
                    // 形如 day:2026-10-28
                    if (row.kind().startsWith("day:")) {
                        createdByDate.put(row.kind().substring(4), row.a());
                    }
                }
            }
        }
        return new StatsAggregate(noteCount, folderCount, tagCount, attachmentCount, attachmentBytes,
                notesTrashed + foldersTrashed, updatedToday, createdByDate);
    }

    public void insert(long userId, Long noteId, String action, String createdAt) {
        jdbc.update("INSERT INTO activities (user_id, note_id, action, created_at) VALUES (?, ?, ?, ?)",
                userId, noteId, action, createdAt);
    }

    /** 行为日志只能挂在当前空间、未删除的笔记上（跨空间一律当作不存在）。 */
    public boolean isAliveNoteInSpace(long noteId, long spaceId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notes WHERE id = ? AND space_id = ? AND deleted_at IS NULL",
                Integer.class, noteId, spaceId);
        return count != null && count > 0;
    }

    /** 同一笔记多次浏览只保留最近一次（GROUP BY + MAX）。 */
    public List<RecentNoteItem> recentViews(long userId, long spaceId, int limit) {
        return jdbc.query("""
                SELECT n.id, n.title, n.folder_id, n.excerpt, MAX(a.created_at) AS viewed_at, MAX(a.id) AS last_id
                FROM activities a
                JOIN notes n ON n.id = a.note_id
                WHERE a.user_id = ? AND a.action = 'view'
                  AND n.space_id = ? AND n.deleted_at IS NULL
                GROUP BY n.id
                ORDER BY viewed_at DESC, last_id DESC
                LIMIT ?
                """, ActivityRepository::mapRecent, userId, spaceId, limit);
    }

    private static RecentNoteItem mapRecent(ResultSet rs, int rowNum) throws SQLException {
        long folderId = rs.getLong("folder_id");
        boolean folderIdIsNull = rs.wasNull();
        return new RecentNoteItem(
                rs.getLong("id"),
                rs.getString("title"),
                folderIdIsNull ? null : folderId,
                rs.getString("excerpt"),
                rs.getString("viewed_at"));
    }
}

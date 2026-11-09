package com.kb.history;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class VersionRepository {

    private static final RowMapper<VersionRow> HISTORY_MAPPER = (rs, rowNum) -> {
        long byRaw = rs.getLong("created_by");
        Long createdBy = rs.wasNull() ? null : byRaw;
        return new VersionRow(rs.getLong("note_id"), rs.getInt("version"), rs.getString("title"),
                rs.getString("content"), rs.getString("created_at"), createdBy);
    };

    private static final RowMapper<VersionRow> CURRENT_MAPPER = (rs, rowNum) -> new VersionRow(
            rs.getLong("note_id"), rs.getInt("version"), rs.getString("title"), rs.getString("content"),
            rs.getString("created_at"), null);

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;

    public VersionRepository(JdbcTemplate jdbc, NamedParameterJdbcTemplate namedJdbc) {
        this.jdbc = jdbc;
        this.namedJdbc = namedJdbc;
    }

    /** note_versions 没有 space_id 列，空间归属只能借 notes 表判定。 */
    public boolean noteExists(long spaceId, long noteId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notes WHERE id = ? AND space_id = ? AND deleted_at IS NULL",
                Integer.class, noteId, spaceId);
        return count != null && count > 0;
    }

    /** 历史版本（不含当前内容），倒序。 */
    public List<VersionRow> listHistory(long noteId) {
        return jdbc.query("SELECT note_id, version, title, content, created_at, created_by"
                + " FROM note_versions WHERE note_id = ? ORDER BY version DESC", HISTORY_MAPPER, noteId);
    }

    public Optional<VersionRow> findInHistory(long noteId, int version) {
        List<VersionRow> rows = jdbc.query("SELECT note_id, version, title, content, created_at, created_by"
                + " FROM note_versions WHERE note_id = ? AND version = ?", HISTORY_MAPPER, noteId, version);
        return rows.stream().findFirst();
    }

    /** 当前版本的内容仍存放在 notes 里（note_versions 只保存被替换掉的历史）。 */
    public Optional<VersionRow> findCurrent(long spaceId, long noteId) {
        List<VersionRow> rows = namedJdbc.query("SELECT n.id AS note_id, n.version, n.title, n.content,"
                + " n.created_at FROM notes n"
                + " WHERE n.id = :noteId AND n.space_id = :spaceId AND n.deleted_at IS NULL",
                new MapSqlParameterSource().addValue("noteId", noteId).addValue("spaceId", spaceId),
                CURRENT_MAPPER);
        return rows.stream().findFirst();
    }

    /**
     * 解析"目标版本"：先查历史快照，查不到再回落到当前版本（当前正文只存在 notes 里，不在 note_versions）。
     *
     * <p>API.md §4.4 要求「对当前版本回滚是 no-op 200」，因此 GET 与 POST 必须共用这同一套解析，
     * 否则会出现「GET 当前版本 200 / POST 回滚同一版本 404」的不自洽。
     */
    public Optional<VersionRow> resolve(long spaceId, long noteId, int version) {
        return findInHistory(noteId, version)
                .or(() -> findCurrent(spaceId, noteId).filter(current -> current.version() == version));
    }

    /** 记录一份历史版本（旧内容）。UNIQUE(note_id, version) 保证同一个版本号只落一次。 */
    public void insert(long noteId, int version, String title, String content, String createdAt,
            Long createdBy) {
        namedJdbc.update("INSERT INTO note_versions (note_id, version, title, content, created_at, created_by)"
                + " VALUES (:noteId, :version, :title, :content, :createdAt, :createdBy)",
                new MapSqlParameterSource()
                        .addValue("noteId", noteId)
                        .addValue("version", version)
                        .addValue("title", title)
                        .addValue("content", content)
                        .addValue("createdAt", createdAt)
                        .addValue("createdBy", createdBy));
    }
}

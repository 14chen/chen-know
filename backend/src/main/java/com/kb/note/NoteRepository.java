package com.kb.note;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class NoteRepository {

    /** 列名一律带 {@code n.} 前缀：带 FTS JOIN 时 search_blob 与 notes_fts 会重名。 */
    private static final String COLUMNS = "n.id, n.space_id, n.folder_id, n.title, n.content, n.excerpt,"
            + " n.search_blob, n.is_favorite, n.is_pinned, n.sort_order, n.version, n.created_at, n.updated_at";

    private static final RowMapper<NoteRow> MAPPER = (rs, rowNum) -> {
        long folderRaw = rs.getLong("folder_id");
        Long folderId = rs.wasNull() ? null : folderRaw;
        return new NoteRow(rs.getLong("id"), rs.getLong("space_id"), folderId, rs.getString("title"),
                rs.getString("content"), rs.getString("excerpt"), rs.getString("search_blob"),
                rs.getInt("is_favorite") != 0, rs.getInt("is_pinned") != 0, rs.getInt("sort_order"),
                rs.getInt("version"), rs.getString("created_at"), rs.getString("updated_at"));
    };

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;

    public NoteRepository(JdbcTemplate jdbc, NamedParameterJdbcTemplate namedJdbc) {
        this.jdbc = jdbc;
        this.namedJdbc = namedJdbc;
    }

    public Optional<NoteRow> findAlive(long spaceId, long id) {
        List<NoteRow> rows = namedJdbc.query("SELECT " + COLUMNS + " FROM notes n"
                + " WHERE n.id = :id AND n.space_id = :spaceId AND n.deleted_at IS NULL",
                new MapSqlParameterSource().addValue("id", id).addValue("spaceId", spaceId), MAPPER);
        return rows.stream().findFirst();
    }

    public List<NoteRow> list(long spaceId, NoteQuery query) {
        MapSqlParameterSource params = params(spaceId);
        params.addValue("limit", query.size());
        params.addValue("offset", query.offset());
        return namedJdbc.query("SELECT " + COLUMNS + from(query) + where(query, params)
                + " ORDER BY " + query.sort().orderBy() + " LIMIT :limit OFFSET :offset", params, MAPPER);
    }

    public long count(long spaceId, NoteQuery query) {
        MapSqlParameterSource params = params(spaceId);
        Long total = namedJdbc.queryForObject("SELECT COUNT(*)" + from(query) + where(query, params),
                params, Long.class);
        return total == null ? 0 : total;
    }

    public long insert(long spaceId, Long folderId, String title, String content, String excerpt,
            String searchBlob, String now) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO notes (space_id, folder_id, title, content, excerpt, search_blob,"
                            + " is_favorite, is_pinned, sort_order, version, created_at, updated_at)"
                            + " VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 1, ?, ?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, spaceId);
            ps.setObject(2, folderId);
            ps.setString(3, title);
            ps.setString(4, content);
            ps.setString(5, excerpt);
            ps.setString(6, searchBlob);
            ps.setString(7, now);
            ps.setString(8, now);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("插入笔记后未取得主键");
        }
        return key.longValue();
    }

    /**
     * 写正文相关列。{@code search_blob} 必须出现在本次 UPDATE 里，
     * 否则 SCHEMA §2 的 {@code notes_fts_au} 触发器不会触发，索引会与正文脱节。
     */
    public int updateContent(long spaceId, long id, String title, String content, String excerpt,
            String searchBlob, int version, String now) {
        return namedJdbc.update("UPDATE notes SET title = :title, content = :content, excerpt = :excerpt,"
                + " search_blob = :searchBlob, version = :version, updated_at = :now"
                + " WHERE id = :id AND space_id = :spaceId AND deleted_at IS NULL",
                new MapSqlParameterSource()
                        .addValue("title", title)
                        .addValue("content", content)
                        .addValue("excerpt", excerpt)
                        .addValue("searchBlob", searchBlob)
                        .addValue("version", version)
                        .addValue("now", now)
                        .addValue("id", id)
                        .addValue("spaceId", spaceId));
    }

    /** 只写与检索无关的列（目录/收藏/置顶/排序），不会触发 FTS 重建。 */
    public int updateMeta(long spaceId, long id, Long folderId, boolean favorite, boolean pinned,
            int sortOrder, String now) {
        return namedJdbc.update("UPDATE notes SET folder_id = :folderId, is_favorite = :favorite,"
                + " is_pinned = :pinned, sort_order = :sortOrder, updated_at = :now"
                + " WHERE id = :id AND space_id = :spaceId AND deleted_at IS NULL",
                new MapSqlParameterSource()
                        .addValue("folderId", folderId)
                        .addValue("favorite", favorite ? 1 : 0)
                        .addValue("pinned", pinned ? 1 : 0)
                        .addValue("sortOrder", sortOrder)
                        .addValue("now", now)
                        .addValue("id", id)
                        .addValue("spaceId", spaceId));
    }

    /** SCHEMA §3：仅置 deleted_at；links 与 note_tags 保留，恢复后标签与出链还在。 */
    public int softDelete(long spaceId, long id, String now) {
        return jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ? AND space_id = ? AND deleted_at IS NULL",
                now, id, spaceId);
    }

    private static MapSqlParameterSource params(long spaceId) {
        return new MapSqlParameterSource().addValue("spaceId", spaceId);
    }

    private static String from(NoteQuery query) {
        return hasText(query.matchExpression())
                ? " FROM notes n JOIN notes_fts ON notes_fts.rowid = n.id"
                : " FROM notes n";
    }

    private static String where(NoteQuery query, MapSqlParameterSource params) {
        StringBuilder sql = new StringBuilder(" WHERE n.space_id = :spaceId AND n.deleted_at IS NULL");
        if (hasText(query.matchExpression())) {
            // SCHEMA §2：必须 JOIN 回 notes 才能过滤软删除与空间；表达式始终是绑定参数
            sql.append(" AND notes_fts MATCH :expr");
            params.addValue("expr", query.matchExpression());
        }
        if (query.folderId() != null) {
            if (query.folderId() == 0L) {
                sql.append(" AND n.folder_id IS NULL");
            } else {
                sql.append(" AND n.folder_id = :folderId");
                params.addValue("folderId", query.folderId());
            }
        }
        if (query.favoriteOnly()) {
            sql.append(" AND n.is_favorite = 1");
        }
        if (hasText(query.tag())) {
            sql.append(" AND EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id"
                    + " WHERE nt.note_id = n.id AND t.space_id = n.space_id"
                    + " AND t.name = :tag COLLATE NOCASE)");
            params.addValue("tag", query.tag());
        }
        return sql.toString();
    }

    private static boolean hasText(String value) {
        return value != null && !value.isEmpty();
    }
}

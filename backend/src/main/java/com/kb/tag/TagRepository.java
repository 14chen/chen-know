package com.kb.tag;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class TagRepository {

    public static final String DEFAULT_COLOR = "#6b7280";

    private static final String COLUMNS = "id, name, color";

    private static final RowMapper<TagRef> MAPPER = (rs, rowNum) ->
            new TagRef(rs.getLong("id"), rs.getString("name"), rs.getString("color"));

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;

    public TagRepository(JdbcTemplate jdbc, NamedParameterJdbcTemplate namedJdbc) {
        this.jdbc = jdbc;
        this.namedJdbc = namedJdbc;
    }

    /** API.md §6：count 为未删除笔记数，count = 0 的标签同样返回；按名称排序保证输出稳定。 */
    public List<TagResponse> listWithCount(long spaceId) {
        return jdbc.query("""
                SELECT t.id, t.name, t.color,
                       (SELECT COUNT(*) FROM note_tags nt
                          JOIN notes n ON n.id = nt.note_id
                         WHERE nt.tag_id = t.id AND n.space_id = t.space_id AND n.deleted_at IS NULL) AS note_count
                FROM tags t
                WHERE t.space_id = ?
                ORDER BY t.name COLLATE NOCASE, t.id
                """, (rs, rowNum) -> new TagResponse(
                rs.getLong("id"), rs.getString("name"), rs.getString("color"), rs.getLong("note_count")), spaceId);
    }

    public long countNotes(long spaceId, long tagId) {
        Long count = jdbc.queryForObject("""
                SELECT COUNT(*) FROM note_tags nt
                JOIN notes n ON n.id = nt.note_id
                WHERE nt.tag_id = ? AND n.space_id = ? AND n.deleted_at IS NULL
                """, Long.class, tagId, spaceId);
        return count == null ? 0 : count;
    }

    public List<TagRef> findByNote(long spaceId, long noteId) {
        return jdbc.query("""
                SELECT t.id, t.name, t.color
                FROM note_tags nt
                JOIN tags t ON t.id = nt.tag_id
                WHERE nt.note_id = ? AND t.space_id = ?
                ORDER BY t.name COLLATE NOCASE, t.id
                """, MAPPER, noteId, spaceId);
    }

    /** 列表页一次性取回整页笔记的标签，避免 N+1。 */
    public Map<Long, List<TagRef>> findByNotes(long spaceId, List<Long> noteIds) {
        if (noteIds.isEmpty()) {
            return Map.of();
        }
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("spaceId", spaceId)
                .addValue("noteIds", noteIds);
        List<Map.Entry<Long, TagRef>> rows = namedJdbc.query("""
                SELECT nt.note_id, t.id, t.name, t.color
                FROM note_tags nt
                JOIN tags t ON t.id = nt.tag_id
                WHERE t.space_id = :spaceId AND nt.note_id IN (:noteIds)
                ORDER BY t.name COLLATE NOCASE, t.id
                """, params, (rs, rowNum) -> Map.entry(rs.getLong("note_id"),
                new TagRef(rs.getLong("id"), rs.getString("name"), rs.getString("color"))));
        Map<Long, List<TagRef>> grouped = new LinkedHashMap<>();
        for (Map.Entry<Long, TagRef> row : rows) {
            grouped.computeIfAbsent(row.getKey(), key -> new ArrayList<>()).add(row.getValue());
        }
        return grouped;
    }

    public Optional<TagRef> findById(long spaceId, long tagId) {
        List<TagRef> rows = jdbc.query(
                "SELECT " + COLUMNS + " FROM tags WHERE id = ? AND space_id = ?", MAPPER, tagId, spaceId);
        return rows.stream().findFirst();
    }

    /** 标签名在同一空间内大小写不敏感唯一（SCHEMA §1 的 UNIQUE 约束）。 */
    public Optional<TagRef> findByName(long spaceId, String name) {
        List<TagRef> rows = jdbc.query(
                "SELECT " + COLUMNS + " FROM tags WHERE space_id = ? AND name = ? COLLATE NOCASE",
                MAPPER, spaceId, name);
        return rows.stream().findFirst();
    }

    public long insert(long spaceId, String name, String color) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO tags (space_id, name, color) VALUES (?, ?, ?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, spaceId);
            ps.setString(2, name);
            ps.setString(3, color);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("插入标签后未取得主键");
        }
        return key.longValue();
    }

    /** 只更新非 null 字段；列名来自白名单，值走绑定参数。 */
    public int update(long spaceId, long tagId, String name, String color) {
        List<String> assignments = new ArrayList<>();
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("id", tagId)
                .addValue("spaceId", spaceId);
        if (name != null) {
            assignments.add("name = :name");
            params.addValue("name", name);
        }
        if (color != null) {
            assignments.add("color = :color");
            params.addValue("color", color);
        }
        if (assignments.isEmpty()) {
            return 0;
        }
        return namedJdbc.update("UPDATE tags SET " + String.join(", ", assignments)
                + " WHERE id = :id AND space_id = :spaceId", params);
    }

    /** 删除标签；note_tags 由外键 ON DELETE CASCADE 清理（SCHEMA §3）。 */
    public int delete(long spaceId, long tagId) {
        return jdbc.update("DELETE FROM tags WHERE id = ? AND space_id = ?", tagId, spaceId);
    }

    /** 覆盖式重建某笔记的标签关联。 */
    public void replaceNoteTags(long noteId, List<Long> tagIds) {
        jdbc.update("DELETE FROM note_tags WHERE note_id = ?", noteId);
        for (Long tagId : tagIds) {
            jdbc.update("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)", noteId, tagId);
        }
    }
}

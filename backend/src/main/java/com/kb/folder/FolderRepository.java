package com.kb.folder;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.HashMap;
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
public class FolderRepository {

    /** 契约 §3：同一父节点下按 sort_order 升序，相同则按 id 升序（稳定排序）。 */
    private static final String ORDER_BY = " ORDER BY sort_order ASC, id ASC";

    private static final RowMapper<FolderRow> MAPPER = (rs, rowNum) -> {
        long parentRaw = rs.getLong("parent_id");
        Long parentId = rs.wasNull() ? null : parentRaw;
        return new FolderRow(rs.getLong("id"), parentId, rs.getString("name"), rs.getInt("sort_order"));
    };

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;

    public FolderRepository(JdbcTemplate jdbc, NamedParameterJdbcTemplate namedJdbc) {
        this.jdbc = jdbc;
        this.namedJdbc = namedJdbc;
    }

    public List<FolderRow> listAlive(long spaceId) {
        return jdbc.query("SELECT id, parent_id, name, sort_order FROM folders"
                + " WHERE space_id = ? AND deleted_at IS NULL" + ORDER_BY, MAPPER, spaceId);
    }

    public Optional<FolderRow> findAlive(long spaceId, long id) {
        List<FolderRow> rows = jdbc.query("SELECT id, parent_id, name, sort_order FROM folders"
                + " WHERE id = ? AND space_id = ? AND deleted_at IS NULL", MAPPER, id, spaceId);
        return rows.stream().findFirst();
    }

    /** 各目录下的**直属**未删除笔记数；与 GET /api/notes?folderId=<id> 的 total 同口径。 */
    public Map<Long, Long> aliveNoteCounts(long spaceId) {
        Map<Long, Long> counts = new HashMap<>();
        jdbc.query("SELECT folder_id, COUNT(*) AS note_count FROM notes"
                + " WHERE space_id = ? AND deleted_at IS NULL AND folder_id IS NOT NULL"
                + " GROUP BY folder_id", rs -> {
            counts.put(rs.getLong("folder_id"), rs.getLong("note_count"));
        }, spaceId);
        return counts;
    }

    public long countNotesIn(long spaceId, long folderId) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM notes"
                + " WHERE space_id = ? AND folder_id = ? AND deleted_at IS NULL", Long.class, spaceId, folderId);
        return count == null ? 0 : count;
    }

    /** candidate 是否在 ancestor 的子树内（含 ancestor 自身）；用于移动目录时的成环检查。 */
    public boolean isDescendant(long spaceId, long ancestorId, long candidateId) {
        Integer count = jdbc.queryForObject("""
                WITH RECURSIVE sub(id) AS (
                  SELECT id FROM folders WHERE id = ? AND space_id = ?
                  UNION ALL
                  SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id WHERE f.space_id = ?
                )
                SELECT COUNT(*) FROM sub WHERE id = ?
                """, Integer.class, ancestorId, spaceId, spaceId, candidateId);
        return count != null && count > 0;
    }

    public long insert(long spaceId, Long parentId, String name, int sortOrder, String now) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO folders (space_id, parent_id, name, sort_order, created_at, updated_at)"
                            + " VALUES (?, ?, ?, ?, ?, ?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, spaceId);
            ps.setObject(2, parentId);
            ps.setString(3, name);
            ps.setInt(4, sortOrder);
            ps.setString(5, now);
            ps.setString(6, now);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("插入目录后未取得主键");
        }
        return key.longValue();
    }

    public int updateFields(long spaceId, long id, String name, Long parentId, int sortOrder, String now) {
        return namedJdbc.update("UPDATE folders SET name = :name, parent_id = :parentId,"
                + " sort_order = :sortOrder, updated_at = :now"
                + " WHERE id = :id AND space_id = :spaceId AND deleted_at IS NULL",
                new MapSqlParameterSource()
                        .addValue("name", name)
                        .addValue("parentId", parentId)
                        .addValue("sortOrder", sortOrder)
                        .addValue("now", now)
                        .addValue("id", id)
                        .addValue("spaceId", spaceId));
    }

    /** 该目录及全部子孙目录 id 的递归 CTE（SCHEMA §3），供软删两个步骤共用。 */
    private static final String SUBTREE_CTE = """
            WITH RECURSIVE sub(id) AS (
              SELECT id FROM folders WHERE id = :folderId AND space_id = :spaceId AND deleted_at IS NULL
              UNION ALL
              SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
               WHERE f.space_id = :spaceId AND f.deleted_at IS NULL
            )
            """;

    /** 先把子树内笔记软删（此时目录尚存活，CTE 仍能走通），再软删目录本身。 */
    public int softDeleteNotesInSubtree(long spaceId, long folderId, String now) {
        return namedJdbc.update(SUBTREE_CTE + """
                UPDATE notes SET deleted_at = :now
                 WHERE space_id = :spaceId AND deleted_at IS NULL
                   AND folder_id IN (SELECT id FROM sub)
                """, subtreeParams(spaceId, folderId, now));
    }

    public int softDeleteSubtreeFolders(long spaceId, long folderId, String now) {
        return namedJdbc.update(SUBTREE_CTE + """
                UPDATE folders SET deleted_at = :now
                 WHERE space_id = :spaceId AND deleted_at IS NULL AND id IN (SELECT id FROM sub)
                """, subtreeParams(spaceId, folderId, now));
    }

    private static MapSqlParameterSource subtreeParams(long spaceId, long folderId, String now) {
        return new MapSqlParameterSource()
                .addValue("folderId", folderId)
                .addValue("spaceId", spaceId)
                .addValue("now", now);
    }
}

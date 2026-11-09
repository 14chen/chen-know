package com.kb.trash;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 回收站 SQL。全部语句都带 {@code space_id} 条件（SCHEMA §0 多租户隔离）。
 *
 * <p>子树一律用递归 CTE 取（SCHEMA §3）；彻底删除交给 SQL 级联：
 * {@code note_versions}/{@code note_tags}/{@code links} 随笔记 ON DELETE CASCADE，
 * FTS 行由 {@code notes_fts_ad} 触发器清掉。
 */
@Repository
public class TrashRepository {

    /** 目录子树递归 CTE 前缀，后接 UPDATE / DELETE 语句。 */
    private static final String FOLDER_SUBTREE_CTE = """
            WITH RECURSIVE sub(id) AS (
              SELECT id FROM folders WHERE id = :folderId AND space_id = :spaceId
              UNION ALL
              SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id WHERE f.space_id = :spaceId
            )
            """;

    private static final RowMapper<TrashNoteItem> NOTE_MAPPER = (rs, rowNum) -> new TrashNoteItem(
            rs.getLong("id"),
            rs.getString("title"),
            nullableLong(rs, "folder_id"),
            rs.getString("folder_name"),
            rs.getString("excerpt"),
            rs.getString("deleted_at"));

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;

    public TrashRepository(JdbcTemplate jdbc, NamedParameterJdbcTemplate namedJdbc) {
        this.jdbc = jdbc;
        this.namedJdbc = namedJdbc;
    }

    public List<TrashNoteItem> deletedNotes(long spaceId) {
        return jdbc.query("""
                SELECT n.id, n.title, n.folder_id, f.name AS folder_name, n.excerpt, n.deleted_at
                FROM notes n
                LEFT JOIN folders f ON f.id = n.folder_id
                WHERE n.space_id = ? AND n.deleted_at IS NOT NULL
                ORDER BY n.deleted_at DESC, n.id DESC
                """, NOTE_MAPPER, spaceId);
    }

    /**
     * 回收站目录 + 每个目录随删的笔记数。
     * {@code tree} 把每个已删目录映射到它全部子孙目录 id，用于统计同一时间戳下随删的笔记。
     */
    public List<TrashFolderItem> deletedFolders(long spaceId) {
        return namedJdbc.query("""
                WITH RECURSIVE tree(root_id, id) AS (
                  SELECT id, id FROM folders WHERE space_id = :spaceId AND deleted_at IS NOT NULL
                  UNION ALL
                  SELECT t.root_id, f.id FROM folders f JOIN tree t ON f.parent_id = t.id WHERE f.space_id = :spaceId
                )
                SELECT f.id, f.parent_id, f.name, f.deleted_at,
                       (SELECT COUNT(*) FROM notes n JOIN tree t ON t.id = n.folder_id
                         WHERE t.root_id = f.id AND n.space_id = :spaceId AND n.deleted_at = f.deleted_at) AS note_count
                FROM folders f
                WHERE f.space_id = :spaceId AND f.deleted_at IS NOT NULL
                ORDER BY f.deleted_at DESC, f.id DESC
                """, new MapSqlParameterSource("spaceId", spaceId), (rs, rowNum) -> new TrashFolderItem(
                rs.getLong("id"),
                nullableLong(rs, "parent_id"),
                rs.getString("name"),
                rs.getString("deleted_at"),
                rs.getLong("note_count")));
    }

    /** 取已软删目录的删除时间戳；不存在或不属于本空间则返回空（调用方回 404）。 */
    public Optional<String> deletedAtOfDeletedFolder(long folderId, long spaceId) {
        List<String> rows = jdbc.queryForList(
                "SELECT deleted_at FROM folders WHERE id = ? AND space_id = ? AND deleted_at IS NOT NULL",
                String.class, folderId, spaceId);
        return rows.stream().findFirst();
    }

    public int restoreNote(long noteId, long spaceId, String now) {
        return jdbc.update("UPDATE notes SET deleted_at = NULL, updated_at = ?"
                + " WHERE id = ? AND space_id = ? AND deleted_at IS NOT NULL", now, noteId, spaceId);
    }

    /**
     * 恢复祖先目录链（只恢复目录，不动祖先里的笔记）。
     *
     * <p>没有这一步，单独恢复一个子目录会得到「存活目录挂在已删目录下」的不可见状态，
     * 且该状态会让后续「彻底删除/清空回收站」的级联删到存活子目录。语义上用户也不知道
     * 为什么恢复后目录不见了。
     */
    public int restoreFolderAncestors(long folderId, long spaceId, String now) {
        return namedJdbc.update("""
                WITH RECURSIVE anc(id, parent_id) AS (
                  SELECT id, parent_id FROM folders WHERE id = :folderId AND space_id = :spaceId
                  UNION ALL
                  SELECT f.id, f.parent_id FROM folders f JOIN anc ON f.id = anc.parent_id WHERE f.space_id = :spaceId
                )
                UPDATE folders SET deleted_at = NULL, updated_at = :now
                WHERE space_id = :spaceId AND deleted_at IS NOT NULL AND id IN (SELECT id FROM anc)
                """, new MapSqlParameterSource("folderId", folderId).addValue("spaceId", spaceId).addValue("now", now));
    }

    /** 恢复子树里与本次操作同时间戳的目录（同一次删除写入的 deleted_at 相同）。 */
    public int restoreFolderSubtree(long folderId, long spaceId, String deletedAt, String now) {
        return namedJdbc.update(FOLDER_SUBTREE_CTE + """
                UPDATE folders SET deleted_at = NULL, updated_at = :now
                WHERE id IN (SELECT id FROM sub) AND deleted_at = :deletedAt
                """, params(folderId, spaceId, deletedAt).addValue("now", now));
    }

    /** 恢复随目录一起被删的笔记（判据：deleted_at 与目录删除时间戳相同，且位于该子树内）。 */
    public int restoreNotesUnderFolderSubtree(long folderId, long spaceId, String deletedAt, String now) {
        return namedJdbc.update(FOLDER_SUBTREE_CTE + """
                UPDATE notes SET deleted_at = NULL, updated_at = :now
                WHERE space_id = :spaceId AND deleted_at = :deletedAt AND folder_id IN (SELECT id FROM sub)
                """, params(folderId, spaceId, deletedAt).addValue("now", now));
    }

    public int purgeNote(long noteId, long spaceId) {
        return jdbc.update("DELETE FROM notes WHERE id = ? AND space_id = ? AND deleted_at IS NOT NULL",
                noteId, spaceId);
    }

    /** 先删笔记：notes.folder_id 是 ON DELETE SET NULL，不显式删会留下变成游离项的回收站笔记。 */
    public int purgeNotesUnderFolderSubtree(long folderId, long spaceId) {
        return namedJdbc.update(FOLDER_SUBTREE_CTE + """
                DELETE FROM notes
                WHERE space_id = :spaceId AND deleted_at IS NOT NULL AND folder_id IN (SELECT id FROM sub)
                """, params(folderId, spaceId, null));
    }

    public int purgeFolderSubtree(long folderId, long spaceId) {
        return namedJdbc.update(FOLDER_SUBTREE_CTE + """
                DELETE FROM folders
                WHERE space_id = :spaceId AND id IN (SELECT id FROM sub)
                """, params(folderId, spaceId, null));
    }

    public long countDeletedNotes(long spaceId) {
        return count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NOT NULL", spaceId);
    }

    public long countDeletedFolders(long spaceId) {
        return count("SELECT COUNT(*) FROM folders WHERE space_id = ? AND deleted_at IS NOT NULL", spaceId);
    }

    public int deleteAllDeletedNotes(long spaceId) {
        return jdbc.update("DELETE FROM notes WHERE space_id = ? AND deleted_at IS NOT NULL", spaceId);
    }

    public int deleteAllDeletedFolders(long spaceId) {
        return jdbc.update("DELETE FROM folders WHERE space_id = ? AND deleted_at IS NOT NULL", spaceId);
    }

    private MapSqlParameterSource params(long folderId, long spaceId, String deletedAt) {
        return new MapSqlParameterSource("folderId", folderId)
                .addValue("spaceId", spaceId)
                .addValue("deletedAt", deletedAt);
    }

    private long count(String sql, long spaceId) {
        Long value = jdbc.queryForObject(sql, Long.class, spaceId);
        return value == null ? 0 : value;
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }
}

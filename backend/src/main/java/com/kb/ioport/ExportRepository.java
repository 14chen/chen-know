package com.kb.ioport;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/** 导出所需的只读查询，全部带 {@code space_id} 条件。 */
@Repository
public class ExportRepository {

    private static final RowMapper<ExportNote> NOTE_MAPPER = (rs, rowNum) -> {
        long folderId = rs.getLong("folder_id");
        boolean folderIdIsNull = rs.wasNull();
        return new ExportNote(
                rs.getLong("id"),
                folderIdIsNull ? null : folderId,
                rs.getString("title"),
                rs.getString("content"),
                rs.getString("created_at"),
                rs.getString("updated_at"));
    };

    private final JdbcTemplate jdbc;

    public ExportRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<ExportNote> findAliveNote(long noteId, long spaceId) {
        List<ExportNote> rows = jdbc.query("SELECT id, folder_id, title, content, created_at, updated_at"
                + " FROM notes WHERE id = ? AND space_id = ? AND deleted_at IS NULL", NOTE_MAPPER, noteId, spaceId);
        return rows.stream().findFirst();
    }

    public List<ExportNote> aliveNotes(long spaceId) {
        return jdbc.query("SELECT id, folder_id, title, content, created_at, updated_at FROM notes"
                + " WHERE space_id = ? AND deleted_at IS NULL ORDER BY id", NOTE_MAPPER, spaceId);
    }

    public List<FolderRow> aliveFolders(long spaceId) {
        return jdbc.query("SELECT id, parent_id, name FROM folders WHERE space_id = ? AND deleted_at IS NULL ORDER BY id",
                (rs, rowNum) -> new FolderRow(rs.getLong("id"), nullableLong(rs, "parent_id"), rs.getString("name")),
                spaceId);
    }

    public List<String> tagsOfNote(long noteId) {
        return jdbc.queryForList("""
                SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
                WHERE nt.note_id = ? ORDER BY t.name COLLATE NOCASE
                """, String.class, noteId);
    }

    /** 一次查完全空间的笔记-标签关系，避免逐篇查询（N+1）。 */
    public Map<Long, List<String>> tagsByNote(long spaceId) {
        Map<Long, List<String>> result = new LinkedHashMap<>();
        jdbc.query("""
                SELECT nt.note_id AS note_id, t.name AS name
                FROM note_tags nt
                JOIN tags t ON t.id = nt.tag_id
                JOIN notes n ON n.id = nt.note_id
                WHERE n.space_id = ? AND n.deleted_at IS NULL
                ORDER BY t.name COLLATE NOCASE
                """, rs -> {
            result.computeIfAbsent(rs.getLong("note_id"), key -> new ArrayList<>()).add(rs.getString("name"));
        }, spaceId);
        return result;
    }

    public List<ExportAttachment> attachments(long spaceId) {
        return jdbc.query("""
                SELECT id, note_id, stored_name, original_name, mime_type, size_bytes, sha256
                FROM attachments WHERE space_id = ? ORDER BY id
                """, (rs, rowNum) -> new ExportAttachment(
                rs.getLong("id"),
                nullableLong(rs, "note_id"),
                rs.getString("stored_name"),
                rs.getString("original_name"),
                rs.getString("mime_type"),
                rs.getLong("size_bytes"),
                rs.getString("sha256")), spaceId);
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }
}

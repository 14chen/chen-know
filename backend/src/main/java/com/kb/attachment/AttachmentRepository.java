package com.kb.attachment;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class AttachmentRepository {

    private static final String COLUMNS =
            "id, space_id, note_id, stored_name, original_name, mime_type, size_bytes, sha256, created_at";

    private static final RowMapper<Attachment> MAPPER = (rs, rowNum) -> {
        long noteId = rs.getLong("note_id");
        return new Attachment(
                rs.getLong("id"),
                rs.getLong("space_id"),
                rs.wasNull() ? null : noteId,
                rs.getString("stored_name"),
                rs.getString("original_name"),
                rs.getString("mime_type"),
                rs.getLong("size_bytes"),
                rs.getString("sha256"),
                rs.getString("created_at"));
    };

    private final JdbcTemplate jdbc;

    public AttachmentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 附件所属笔记的归属校验：必须存在、未删除、且同空间（跨空间一律当作不存在）。 */
    public boolean isAliveNoteInSpace(long noteId, long spaceId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notes WHERE id = ? AND space_id = ? AND deleted_at IS NULL",
                Integer.class, noteId, spaceId);
        return count != null && count > 0;
    }

    public long insert(long spaceId, Long noteId, String storedName, String originalName, String mimeType,
            long sizeBytes, String sha256, String createdAt) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO attachments (space_id, note_id, stored_name, original_name, mime_type,"
                            + " size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, spaceId);
            if (noteId == null) {
                ps.setNull(2, java.sql.Types.INTEGER);
            } else {
                ps.setLong(2, noteId);
            }
            ps.setString(3, storedName);
            ps.setString(4, originalName);
            ps.setString(5, mimeType);
            ps.setLong(6, sizeBytes);
            ps.setString(7, sha256);
            ps.setString(8, createdAt);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("插入附件后未取得主键");
        }
        return key.longValue();
    }

    /** @param noteTitle 关联笔记标题（可能为 null：笔记已删除或附件未关联笔记） */
    public record SpaceAttachment(long id, Long noteId, String noteTitle, String storedName,
            String originalName, long sizeBytes) {
    }

    /** 体检用：列出该空间全部附件（带笔记标题），不加载内容。 */
    public List<SpaceAttachment> findBySpace(long spaceId) {
        return jdbc.query("SELECT a.id, a.note_id, n.title AS note_title, a.stored_name, a.original_name,"
                        + " a.size_bytes FROM attachments a LEFT JOIN notes n ON n.id = a.note_id"
                        + " WHERE a.space_id = ? ORDER BY a.id",
                (rs, rowNum) -> {
                    long noteRaw = rs.getLong("note_id");
                    Long noteId = rs.wasNull() ? null : noteRaw;
                    return new SpaceAttachment(rs.getLong("id"), noteId, rs.getString("note_title"),
                            rs.getString("stored_name"), rs.getString("original_name"),
                            rs.getLong("size_bytes"));
                },
                spaceId);
    }

    public Optional<Attachment> findByIdAndSpace(long id, long spaceId) {
        List<Attachment> rows = jdbc.query(
                "SELECT " + COLUMNS + " FROM attachments WHERE id = ? AND space_id = ?", MAPPER, id, spaceId);
        return rows.stream().findFirst();
    }

    public int deleteByIdAndSpace(long id, long spaceId) {
        return jdbc.update("DELETE FROM attachments WHERE id = ? AND space_id = ?", id, spaceId);
    }
}

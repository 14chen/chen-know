package com.kb.archive;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

/** 归档用的最小 SQL 集合（只搬 folder_id / parent_id，绝不删任何行）。 */
@Repository
public class ArchiveRepository {

    private final JdbcTemplate jdbc;

    public ArchiveRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Folder(long id, Long parentId, String name) {
    }

    public record NoteBrief(long id, Long folderId, String title) {
    }

    public long insertRun(long spaceId, String startedAt) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            java.sql.PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO archive_runs (space_id, started_at, status, moved_folders, moved_notes,"
                            + " skipped) VALUES (?, ?, 'running', 0, 0, 0)",
                    java.sql.Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, spaceId);
            ps.setString(2, startedAt);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("插入归档运行记录后未取得主键");
        }
        return key.longValue();
    }

    public void finishRun(long runId, String finishedAt, String status, int movedFolders, int movedNotes,
            int skipped, String error) {
        jdbc.update("UPDATE archive_runs SET finished_at = ?, status = ?, moved_folders = ?, moved_notes = ?,"
                + " skipped = ?, error = ? WHERE id = ?",
                finishedAt, status, movedFolders, movedNotes, skipped, error, runId);
    }

    public record Run(long id, String startedAt, String finishedAt, String status, int movedFolders,
            int movedNotes, int skipped, String error) {
    }

    public List<Run> recent(long spaceId, int limit) {
        return jdbc.query("SELECT id, started_at, finished_at, status, moved_folders, moved_notes, skipped,"
                        + " error FROM archive_runs WHERE space_id = ? ORDER BY id DESC LIMIT ?",
                (rs, rowNum) -> new Run(rs.getLong("id"), rs.getString("started_at"),
                        rs.getString("finished_at"), rs.getString("status"), rs.getInt("moved_folders"),
                        rs.getInt("moved_notes"), rs.getInt("skipped"), rs.getString("error")),
                spaceId, limit);
    }

    public List<Long> allSpaceIds() {
        return jdbc.queryForList("SELECT id FROM spaces ORDER BY id", Long.class);
    }

    public List<Folder> childFolders(long spaceId, Long parentId) {
        if (parentId == null) {
            return jdbc.query("SELECT id, parent_id, name FROM folders WHERE space_id = ?"
                    + " AND parent_id IS NULL AND deleted_at IS NULL ORDER BY id",
                    (rs, rowNum) -> new Folder(rs.getLong("id"), null, rs.getString("name")), spaceId);
        }
        return jdbc.query("SELECT id, parent_id, name FROM folders WHERE space_id = ? AND parent_id = ?"
                        + " AND deleted_at IS NULL ORDER BY id",
                (rs, rowNum) -> new Folder(rs.getLong("id"), rs.getLong("parent_id"), rs.getString("name")),
                spaceId, parentId);
    }

    /** 按名字找直接子目录（重名就复用）。 */
    public Optional<Folder> childFolderByName(long spaceId, Long parentId, String name) {
        return childFolders(spaceId, parentId).stream()
                .filter(folder -> folder.name().equals(name))
                .findFirst();
    }

    public long createFolder(long spaceId, Long parentId, String name, String now) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            java.sql.PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO folders (space_id, parent_id, name, sort_order, created_at, updated_at)"
                            + " VALUES (?, ?, ?, 0, ?, ?)",
                    java.sql.Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, spaceId);
            if (parentId == null) {
                ps.setNull(2, java.sql.Types.INTEGER);
            } else {
                ps.setLong(2, parentId);
            }
            ps.setString(3, name);
            ps.setString(4, now);
            ps.setString(5, now);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("创建归档目录后未取得主键");
        }
        return key.longValue();
    }

    public int moveFolder(long spaceId, long folderId, long newParentId, String now) {
        return jdbc.update("UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ? AND space_id = ?"
                + " AND deleted_at IS NULL", newParentId, now, folderId, spaceId);
    }

    public List<NoteBrief> notesByTitlePrefix(long spaceId, String prefix) {
        return jdbc.query("SELECT id, folder_id, title FROM notes WHERE space_id = ? AND deleted_at IS NULL"
                        + " AND title LIKE ? ORDER BY id",
                (rs, rowNum) -> {
                    long folderRaw = rs.getLong("folder_id");
                    Long folderId = rs.wasNull() ? null : folderRaw;
                    return new NoteBrief(rs.getLong("id"), folderId, rs.getString("title"));
                }, spaceId, prefix + "%");
    }

    public int moveNote(long spaceId, long noteId, long folderId, String now) {
        return jdbc.update("UPDATE notes SET folder_id = ?, updated_at = ? WHERE id = ? AND space_id = ?"
                + " AND deleted_at IS NULL", folderId, now, noteId, spaceId);
    }

    public boolean noteTitleExistsInFolder(long spaceId, long folderId, String title, long excludeId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM notes WHERE space_id = ? AND folder_id = ?"
                + " AND title = ? AND deleted_at IS NULL AND id <> ?", Integer.class, spaceId, folderId,
                title, excludeId);
        return count != null && count > 0;
    }

    public int countNotes(long spaceId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL", Integer.class, spaceId);
        return count == null ? 0 : count;
    }

    public int countNotesInFolder(long spaceId, long folderId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM notes WHERE space_id = ? AND folder_id = ?"
                + " AND deleted_at IS NULL", Integer.class, spaceId, folderId);
        return count == null ? 0 : count;
    }
}

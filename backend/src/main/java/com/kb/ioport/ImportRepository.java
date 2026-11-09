package com.kb.ioport;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

/** 导入写入（notes / folders / tags），全部限定在当前 space 内。 */
@Repository
public class ImportRepository {

    private final JdbcTemplate jdbc;

    public ImportRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Long findAliveFolderId(long spaceId, Long parentId, String name) {
        List<Long> rows = parentId == null
                ? jdbc.queryForList("SELECT id FROM folders WHERE space_id = ? AND parent_id IS NULL"
                        + " AND deleted_at IS NULL AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1",
                        Long.class, spaceId, name)
                : jdbc.queryForList("SELECT id FROM folders WHERE space_id = ? AND parent_id = ?"
                        + " AND deleted_at IS NULL AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1",
                        Long.class, spaceId, parentId, name);
        return rows.stream().findFirst().orElse(null);
    }

    public long insertFolder(long spaceId, Long parentId, String name, String now) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO folders (space_id, parent_id, name, sort_order, created_at, updated_at)"
                            + " VALUES (?, ?, ?, 0, ?, ?)", Statement.RETURN_GENERATED_KEYS);
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
            throw new IllegalStateException("插入目录后未取得主键");
        }
        return key.longValue();
    }

    /** 新笔记 version=1：{@code note_versions} 只存历史版本，首版即当前正文，不另插入。 */
    public long insertNote(long spaceId, Long folderId, String title, String content, String excerpt, String blob,
            String now) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO notes (space_id, folder_id, title, content, excerpt, search_blob,"
                            + " is_favorite, is_pinned, sort_order, version, created_at, updated_at)"
                            + " VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 1, ?, ?)", Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, spaceId);
            if (folderId == null) {
                ps.setNull(2, java.sql.Types.INTEGER);
            } else {
                ps.setLong(2, folderId);
            }
            ps.setString(3, title);
            ps.setString(4, content);
            ps.setString(5, excerpt);
            ps.setString(6, blob);
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

    /** {@code tags} 有 (space_id, name COLLATE NOCASE) 唯一约束，用 INSERT OR IGNORE 幂等创建。 */
    public void ensureTag(long spaceId, String name) {
        jdbc.update("INSERT OR IGNORE INTO tags (space_id, name, color) VALUES (?, ?, '#6b7280')", spaceId, name);
    }

    public Long findTagId(long spaceId, String name) {
        List<Long> rows = jdbc.queryForList(
                "SELECT id FROM tags WHERE space_id = ? AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1",
                Long.class, spaceId, name);
        return rows.stream().findFirst().orElse(null);
    }

    public void linkNoteTag(long noteId, long tagId) {
        jdbc.update("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)", noteId, tagId);
    }
}

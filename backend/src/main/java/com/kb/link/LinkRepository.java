package com.kb.link;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class LinkRepository {

    /** 出链：{@code alive*} 为 null 表示目标标题尚未创建或已软删除（视作 dangling）。 */
    public record OutlinkRow(String targetTitle, Long aliveNoteId, String aliveTitle, Long aliveFolderId) {
    }

    /** 反链：带上来源笔记原文，供服务层截取上下文片段。 */
    public record BacklinkRow(long sourceNoteId, String sourceTitle, String sourceContent, String targetTitle) {
    }

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;

    public LinkRepository(JdbcTemplate jdbc, NamedParameterJdbcTemplate namedJdbc) {
        this.jdbc = jdbc;
        this.namedJdbc = namedJdbc;
    }

    /** 归属校验：links / note_versions 都没有 space_id 之外的隔离手段，必须借 notes 判定。 */
    public boolean noteExists(long spaceId, long noteId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notes WHERE id = ? AND space_id = ? AND deleted_at IS NULL",
                Integer.class, noteId, spaceId);
        return count != null && count > 0;
    }

    /** 保存笔记时全量重建出链：先删后插（API.md §4）。 */
    public int deleteBySource(long sourceNoteId) {
        return jdbc.update("DELETE FROM links WHERE source_note_id = ?", sourceNoteId);
    }

    /**
     * 按 space + 大小写不敏感标题找目标笔记；命中多条时取 id 最小的那一篇（最早创建），保证结果确定。
     *
     * <p>同名多篇的其余笔记不会因此丢链：{@link #backlinks} 会按"目标标题与本篇同名"再匹配一次，
     * 出链侧则通过 {@link #candidateCounts} 把歧义暴露给前端（DEF-E4-002）。
     */
    public Long resolveTitle(long spaceId, String title) {
        List<Long> ids = jdbc.query("SELECT id FROM notes"
                + " WHERE space_id = ? AND deleted_at IS NULL AND title = ? COLLATE NOCASE"
                + " ORDER BY id LIMIT 1", (rs, rowNum) -> rs.getLong(1), spaceId, title);
        return ids.isEmpty() ? null : ids.get(0);
    }

    /**
     * 每个目标标题当前有几篇存活笔记（大小写不敏感）。用于让「同名笔记」的歧义在响应里可观测，
     * 一次聚合查询拿全，避免逐条出链再查一次（N+1）。
     */
    public java.util.Map<String, Integer> candidateCounts(long spaceId, long sourceNoteId) {
        java.util.Map<String, Integer> out = new java.util.LinkedHashMap<>();
        namedJdbc.query("""
                SELECT l.target_title AS title, COUNT(t.id) AS candidates
                FROM links l
                JOIN notes t ON t.space_id = l.space_id AND t.deleted_at IS NULL
                            AND t.title = l.target_title COLLATE NOCASE
                WHERE l.space_id = :spaceId AND l.source_note_id = :noteId
                GROUP BY l.target_title
                """, new MapSqlParameterSource().addValue("spaceId", spaceId).addValue("noteId", sourceNoteId),
                rs -> { out.put(rs.getString("title"), rs.getInt("candidates")); });
        return out;
    }

    public int insert(long spaceId, long sourceNoteId, String targetTitle, Long targetNoteId, String now) {
        return jdbc.update("INSERT OR IGNORE INTO links"
                + " (space_id, source_note_id, target_title, target_note_id, created_at) VALUES (?, ?, ?, ?, ?)",
                spaceId, sourceNoteId, targetTitle, targetNoteId, now);
    }

    public List<OutlinkRow> outlinks(long spaceId, long sourceNoteId) {
        return namedJdbc.query("""
                SELECT l.target_title,
                       n.id AS alive_note_id, n.title AS alive_title, n.folder_id AS alive_folder_id
                FROM links l
                LEFT JOIN notes n ON n.id = l.target_note_id
                     AND n.deleted_at IS NULL AND n.space_id = l.space_id
                WHERE l.space_id = :spaceId AND l.source_note_id = :noteId
                ORDER BY l.id
                """, new MapSqlParameterSource().addValue("spaceId", spaceId).addValue("noteId", sourceNoteId),
                (rs, rowNum) -> {
                    long aliveRaw = rs.getLong("alive_note_id");
                    Long aliveNoteId = rs.wasNull() ? null : aliveRaw;
                    long folderRaw = rs.getLong("alive_folder_id");
                    Long aliveFolderId = rs.wasNull() ? null : folderRaw;
                    return new OutlinkRow(rs.getString("target_title"), aliveNoteId,
                            rs.getString("alive_title"), aliveFolderId);
                });
    }

    /**
     * 反链必须过滤软删除的来源笔记，且不把自己算作自己的反链。
     *
     * <p>匹配条件有两条，缺一不可：
     * <ol>
     *   <li>{@code l.target_note_id = :noteId} —— 常规情况（链接已挂到本篇）</li>
     *   <li>{@code l.target_title} 与本篇标题同名（大小写不敏感）—— 同名多篇时，
     *       链接只会挂到 id 最小的那篇，其余同名笔记靠这条也能看到"被谁引用"，
     *       否则它们会永久反链为空且无从知晓原因（DEF-E4-002）</li>
     * </ol>
     */
    public List<BacklinkRow> backlinks(long spaceId, long targetNoteId) {
        return namedJdbc.query("""
                SELECT l.source_note_id, n.title AS source_title, n.content AS source_content,
                       l.target_title
                FROM links l
                JOIN notes n ON n.id = l.source_note_id
                JOIN notes t ON t.id = :noteId AND t.space_id = :spaceId AND t.deleted_at IS NULL
                WHERE l.space_id = :spaceId
                  AND (l.target_note_id = :noteId OR l.target_title = t.title COLLATE NOCASE)
                  AND n.space_id = :spaceId AND n.deleted_at IS NULL AND n.id <> :noteId
                ORDER BY n.updated_at DESC, n.id DESC
                """, new MapSqlParameterSource().addValue("spaceId", spaceId).addValue("noteId", targetNoteId),
                (rs, rowNum) -> new BacklinkRow(rs.getLong("source_note_id"), rs.getString("source_title"),
                        rs.getString("source_content"), rs.getString("target_title")));
    }

    /** 与 {@link #backlinks} 同一套匹配条件；按来源笔记去重计数，口径与反链列表长度一致。 */
    public long countBacklinks(long spaceId, long targetNoteId) {
        Long count = namedJdbc.queryForObject("""
                SELECT COUNT(DISTINCT l.source_note_id) FROM links l
                JOIN notes n ON n.id = l.source_note_id
                JOIN notes t ON t.id = :noteId AND t.space_id = :spaceId AND t.deleted_at IS NULL
                WHERE l.space_id = :spaceId
                  AND (l.target_note_id = :noteId OR l.target_title = t.title COLLATE NOCASE)
                  AND n.space_id = :spaceId AND n.deleted_at IS NULL AND n.id <> :noteId
                """, new MapSqlParameterSource().addValue("spaceId", spaceId).addValue("noteId", targetNoteId),
                Long.class);
        return count == null ? 0 : count;
    }

    /**
     * 新建或改名后，把此前悬空、如今标题能对上的出链补挂到本笔记。
     * 否则「先写 [[新笔记]] 再新建同名笔记」会永远停留在 dangling。
     */
    public int backfillDangling(long spaceId, long noteId, String title) {
        if (title == null || title.isBlank()) {
            return 0;
        }
        return namedJdbc.update("UPDATE links SET target_note_id = :noteId"
                + " WHERE space_id = :spaceId AND target_note_id IS NULL"
                + " AND target_title = :title COLLATE NOCASE AND source_note_id <> :noteId",
                new MapSqlParameterSource().addValue("noteId", noteId)
                        .addValue("spaceId", spaceId)
                        .addValue("title", title));
    }
}

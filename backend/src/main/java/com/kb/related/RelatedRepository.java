package com.kb.related;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 相关推荐的三条规则，各<b>一条</b> SQL（都把 notes / folders JOIN 进来，避免再查一次标题与目录名）。
 */
@Repository
public class RelatedRepository {

    /** 当前笔记（校验 404 + 抽关键词用）。 */
    public record CurrentNote(long id, Long folderId, String title, String content) {
    }

    /** 候选行：标题与目录名已经在 SQL 里带出来，所以不需要额外的 hydration 查询。 */
    public record Candidate(long id, String title, String folderName, long weight, String tagName) {
    }

    private final JdbcTemplate jdbc;

    public RelatedRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<CurrentNote> currentNote(long spaceId, long noteId) {
        return jdbc.query("SELECT id, folder_id, title, content FROM notes WHERE id = ? AND space_id = ?"
                        + " AND deleted_at IS NULL",
                (rs, rowNum) -> {
                    long folderRaw = rs.getLong("folder_id");
                    return new CurrentNote(rs.getLong("id"), rs.wasNull() ? null : folderRaw,
                            rs.getString("title"), rs.getString("content"));
                }, noteId, spaceId).stream().findFirst();
    }

    /** 规则 1：共同标签，按共同标签数降序。 */
    public List<Candidate> bySharedTags(long spaceId, long noteId, int limit) {
        return jdbc.query("SELECT n.id, n.title, n.folder_id, f.name AS folder_name,"
                        + " COUNT(*) AS common, MIN(t.name) AS tag_name"
                        + " FROM note_tags mine"
                        + " JOIN note_tags other ON other.tag_id = mine.tag_id AND other.note_id <> mine.note_id"
                        + " JOIN notes n ON n.id = other.note_id AND n.space_id = ? AND n.deleted_at IS NULL"
                        + " JOIN tags t ON t.id = mine.tag_id"
                        + " LEFT JOIN folders f ON f.id = n.folder_id AND f.deleted_at IS NULL"
                        + " WHERE mine.note_id = ?"
                        + " GROUP BY n.id, n.title, n.folder_id, f.name"
                        + " ORDER BY common DESC, n.updated_at DESC, n.id DESC LIMIT ?",
                (rs, rowNum) -> new Candidate(rs.getLong("id"), rs.getString("title"),
                        rs.getString("folder_name"), rs.getLong("common"), rs.getString("tag_name")),
                spaceId, noteId, limit);
    }

    /**
     * 规则 2：同目录（排除自己），按最近更新降序。
     *
     * <p>目录名用 JOIN 一次带出来（候选都在同一个目录，取哪一行的都行），避免再查一次目录。
     */
    public List<Candidate> bySameFolder(long spaceId, long noteId, long folderId, int limit) {
        return jdbc.query("SELECT n.id, n.title, f.name AS folder_name FROM notes n"
                        + " LEFT JOIN folders f ON f.id = n.folder_id AND f.deleted_at IS NULL"
                        + " WHERE n.space_id = ? AND n.deleted_at IS NULL AND n.id <> ?"
                        + " AND n.folder_id = ? ORDER BY n.updated_at DESC, n.id DESC LIMIT ?",
                (rs, rowNum) -> new Candidate(rs.getLong("id"), rs.getString("title"),
                        rs.getString("folder_name"), 0L, null),
                spaceId, noteId, folderId, limit);
    }

    /** 规则 3：FTS5 内容相近（表达式由调用方保证是「≥2 个词的 AND」）。 */
    public List<Candidate> byContent(long spaceId, long noteId, String matchExpression, int limit) {
        return jdbc.query("SELECT n.id, n.title, n.folder_id, f.name AS folder_name,"
                        + " bm25(notes_fts) AS score"
                        + " FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid"
                        + " LEFT JOIN folders f ON f.id = n.folder_id AND f.deleted_at IS NULL"
                        + " WHERE notes_fts MATCH ? AND n.space_id = ? AND n.deleted_at IS NULL AND n.id <> ?"
                        + " ORDER BY score LIMIT ?",
                (rs, rowNum) -> {
                    long folderRaw = rs.getLong("folder_id");
                    return new Candidate(rs.getLong("id"), rs.getString("title"),
                            rs.wasNull() ? null : rs.getString("folder_name"), 0L, null);
                },
                matchExpression, spaceId, noteId, limit);
    }
}

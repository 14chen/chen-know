package com.kb.search;

import java.util.List;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 搜索数据访问（API.md §5）。
 *
 * <p>三次性能改造（DEF-E3-001 / E3-002）：
 * <ol>
 *   <li><b>只取窗口</b>：不再把 {@code notes.content} 全文拉到 JVM（大正文 1–2MB 时 JDBC 传输 +
 *       高亮扫描是搜索慢 4 倍的主因），改为在 SQL 里用 {@code instr}+{@code substr} 取出命中词
 *       附近的一段窗口文本供高亮使用；</li>
 *   <li><b>一次查询</b>：用 {@code COUNT(*) OVER ()} 在同一次 FTS 命中里取回总数，
 *       不再额外跑一条 {@code COUNT(*)} JOIN 查询；</li>
 *   <li>结果行数受 {@code LIMIT} 限制，窗口长度也受 {@code LIMIT_WINDOW} 限制。</li>
 * </ol>
 */
@Repository
public class SearchRepository {

    /** 命中行的原始字段：{@code window} 只是正文的一段窗口（不是全文）。 */
    public record SearchRow(long noteId, String title, String excerpt, String window, Long folderId,
            String updatedAt, double score) {
    }

    /** 一页结果 + 总数（同一次查询里带回来）。 */
    public record SearchPage(List<SearchRow> rows, long total) {
    }

    /** 高亮窗口：命中前留白 + 片段长度 + 冗余，足够 HTML 片段与 markdown 摘要两处使用。 */
    static final int WINDOW_PAD = 40;
    static final int WINDOW_LENGTH = 400;

    private static final String COLUMNS = "n.id AS note_id, n.title, n.excerpt,"
            + " n.folder_id, n.updated_at";

    private static final String WINDOW = """
            CASE
              WHEN :probe IS NULL THEN substr(n.content, 1, :windowLength)
              WHEN instr(n.content, :probe) > 0 THEN
                substr(n.content, max(1, instr(n.content, :probe) - :windowPad), :windowLength)
              WHEN :probeLower IS NOT NULL AND instr(n.content, :probeLower) > 0 THEN
                substr(n.content, max(1, instr(n.content, :probeLower) - :windowPad), :windowLength)
              ELSE substr(n.content, 1, :windowLength)
            END AS window_text""";

    private static final RowMapper<SearchRow> MAPPER = (rs, rowNum) -> {
        long folderRaw = rs.getLong("folder_id");
        Long folderId = rs.wasNull() ? null : folderRaw;
        return new SearchRow(rs.getLong("note_id"), rs.getString("title"), rs.getString("excerpt"),
                rs.getString("window_text"), folderId, rs.getString("updated_at"), rs.getDouble("score"));
    };

    private final NamedParameterJdbcTemplate namedJdbc;

    public SearchRepository(NamedParameterJdbcTemplate namedJdbc) {
        this.namedJdbc = namedJdbc;
    }

    public SearchPage search(long spaceId, SearchQuery query) {
        MapSqlParameterSource params = filters(spaceId, query);
        List<Long> folderScope = folderScope(spaceId, query.folderId());
        params.addValue("limit", query.size());
        params.addValue("offset", query.offset());
        params.addValue("windowLength", WINDOW_LENGTH);
        params.addValue("windowPad", WINDOW_PAD);
        String probe = firstProbe(query);
        params.addValue("probe", probe);
        params.addValue("probeLower", probe == null ? null : probe.toLowerCase(java.util.Locale.ROOT));
        String order = query.sortByUpdated() ? " ORDER BY n.updated_at DESC, n.id DESC"
                : query.hasMatch() ? " ORDER BY score ASC, n.updated_at DESC"
                : " ORDER BY n.updated_at DESC, n.id DESC";
        if (query.hasMatch()) {
            // SCHEMA §2 的骨架：external content 表必须 JOIN 回 notes 过滤软删除与空间
            params.addValue("expr", query.matchExpression());
            List<SearchRow> rows = namedJdbc.query("SELECT " + COLUMNS + ", bm25(notes_fts) AS score, " + WINDOW
                    + " FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid"
                    + where(query, params, folderScope) + order + " LIMIT :limit OFFSET :offset",
                    params, MAPPER);
            return page(rows, spaceId, query);
        }
        List<SearchRow> rows = namedJdbc.query("SELECT " + COLUMNS + ", 0.0 AS score, " + WINDOW + " FROM notes n"
                + where(query, params, folderScope) + order + " LIMIT :limit OFFSET :offset",
                params, MAPPER);
        return page(rows, spaceId, query);
    }

    /**
     * 总数：**只在真的需要时**才额外数一次。
     *
     * <p>FTS5 的辅助函数 {@code bm25()} 不允许出现在带窗口函数（{@code COUNT(*) OVER ()}）或分组
     * 的查询里，因此不能再把总数搭在同一条排序查询上；这里用一个更轻的策略：
     * 结果不满一页说明已经是最后一页，总数 = offset + 行数，完全不需要 COUNT；
     * 只有满页（可能还有后续页）时才跑一次 COUNT（无 bm25、无排序，比排序查询轻得多）。
     */
    private SearchPage page(List<SearchRow> rows, long spaceId, SearchQuery query) {
        if (rows.size() < query.size()) {
            return new SearchPage(rows, query.offset() + rows.size());
        }
        return new SearchPage(rows, count(spaceId, query));
    }

    /** 兜底：窗口函数在 LIMIT 之后取不到行时（深分页越界）才额外数一次。 */
    public long count(long spaceId, SearchQuery query) {
        MapSqlParameterSource params = filters(spaceId, query);
        List<Long> folderScope = folderScope(spaceId, query.folderId());
        String from = query.hasMatch()
                ? " FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid"
                : " FROM notes n";
        if (query.hasMatch()) {
            params.addValue("expr", query.matchExpression());
        }
        Long total = namedJdbc.queryForObject("SELECT COUNT(*)" + from
                + where(query, params, folderScope), params, Long.class);
        return total == null ? 0 : total;
    }

    /** 首个可用于窗口定位的探测词（原始大小写）。 */
    private static String firstProbe(SearchQuery query) {
        if (!query.hasMatch() || query.terms().isEmpty()) {
            return null;
        }
        for (String term : query.terms()) {
            if (term != null && !term.isEmpty()) {
                return term;
            }
        }
        return null;
    }

    /**
     * folderId 的搜索范围：该目录 + 所有子孙目录（软删除的目录不算）。
     *
     * @return 空表示不需要按目录过滤（folderId 为 null 或 0）
     */
    List<Long> folderScope(long spaceId, Long folderId) {
        if (folderId == null || folderId == 0L) {
            return List.of();
        }
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("spaceId", spaceId).addValue("folderId", folderId);
        return namedJdbc.queryForList("WITH RECURSIVE tree(id) AS ("
                + " SELECT id FROM folders WHERE space_id = :spaceId AND id = :folderId"
                + "   AND deleted_at IS NULL"
                + " UNION ALL"
                + " SELECT f.id FROM folders f JOIN tree ON f.parent_id = tree.id"
                + " WHERE f.space_id = :spaceId AND f.deleted_at IS NULL)"
                + " SELECT id FROM tree", params, Long.class);
    }

    private static MapSqlParameterSource filters(long spaceId, SearchQuery query) {
        return new MapSqlParameterSource().addValue("spaceId", spaceId);
    }

    private static String where(SearchQuery query, MapSqlParameterSource params, List<Long> folderScope) {
        StringBuilder sql = new StringBuilder(" WHERE n.space_id = :spaceId AND n.deleted_at IS NULL");
        if (query.hasMatch()) {
            sql.append(" AND notes_fts MATCH :expr");
        }
        if (query.folderId() != null) {
            if (query.folderId() == 0L) {
                sql.append(" AND n.folder_id IS NULL");
            } else if (folderScope.isEmpty()) {
                sql.append(" AND 1 = 0");                   // 目录不存在/已删：查不到是正确结果
            } else {
                sql.append(" AND n.folder_id IN (:folderScope)");
                params.addValue("folderScope", folderScope);
            }
        }
        if (query.tag() != null) {
            sql.append(" AND EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id"
                    + " WHERE nt.note_id = n.id AND t.space_id = n.space_id"
                    + " AND t.name = :tag COLLATE NOCASE)");
            params.addValue("tag", query.tag());
        }
        if (query.tagId() != null) {
            sql.append(" AND EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id"
                    + " AND nt.tag_id = :tagId)");
            params.addValue("tagId", query.tagId());
        }
        // updated_at 是 ISO instant（2026-10-25T11:17:38.9Z），取前 10 位当日期比较，含起止当天
        if (query.from() != null) {
            sql.append(" AND substr(n.updated_at, 1, 10) >= :fromDate");
            params.addValue("fromDate", query.from());
        }
        if (query.to() != null) {
            sql.append(" AND substr(n.updated_at, 1, 10) <= :toDate");
            params.addValue("toDate", query.to());
        }
        return sql.toString();
    }
}

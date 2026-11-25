package com.kb.briefing;

import com.kb.briefing.MiniJson;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** briefing_items / briefing_feedback 的数据访问；所有查询强制带 space_id。 */
@Repository
public class BriefingItemRepository {

    private static final String COLUMNS = "run_id, url, title, summary, source, theme, quality_score,"
            + " accepted, rank, key_points, why_it_matters, related_titles, engagement, engagement_level,"
            + " corroboration_count, source_links, top_quote";

    private final JdbcTemplate jdbc;

    public BriefingItemRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final org.springframework.jdbc.core.RowMapper<BriefingItem> MAPPER = (rs, n) ->
            new BriefingItem(rs.getLong("run_id"), rs.getString("url"), rs.getString("title"),
                    rs.getString("summary"), rs.getString("source"), rs.getString("theme"),
                    rs.getInt("quality_score"), rs.getInt("accepted") != 0, rs.getInt("rank"),
                    strings(rs.getString("key_points")), rs.getString("why_it_matters"),
                    strings(rs.getString("related_titles")),
                    rs.getInt("engagement"), rs.getInt("engagement_level"),
                    rs.getInt("corroboration_count"), strings(rs.getString("source_links")),
                    rs.getString("top_quote"));

    private static List<String> strings(String json) {
        if (json == null || json.isBlank()) return List.of();
        List<Object> values = MiniJson.asArray(MiniJson.parse(json));
        List<String> result = new ArrayList<>();
        for (Object value : values) result.add(String.valueOf(value));
        return result;
    }

    public void saveAll(long spaceId, List<BriefingItem> items) {
        if (items.isEmpty()) return;
        jdbc.batchUpdate("INSERT OR REPLACE INTO briefing_items (" + COLUMNS + ", space_id) VALUES (?, ?, ?, ?, ?, ?,"
                        + " ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                items.stream().map(item -> new Object[] {
                        item.runId(), item.url(), item.title(), item.summary(), item.source(), item.theme(),
                        item.qualityScore(), item.accepted() ? 1 : 0, item.rank(),
                        MiniJson.write(item.keyPoints()), item.whyItMatters(),
                        MiniJson.write(item.relatedTitles()), item.engagement(), item.engagementLevel(),
                        item.corroboration(), MiniJson.write(item.sourceLinks()), item.topQuote(), spaceId
                }).toList());
    }

    public List<BriefingItem> listByRun(long spaceId, long runId) {
        return jdbc.query("SELECT " + COLUMNS + " FROM briefing_items WHERE space_id = ? AND run_id = ?"
                + " ORDER BY rank ASC", MAPPER, spaceId, runId);
    }

    /** 分页列表：theme/minScore/q 都是可选过滤条件。 */
    public List<BriefingItem> list(long spaceId, Long runId, String theme, Integer minScore, String query,
            int page, int size) {
        StringBuilder sql = new StringBuilder("SELECT ").append(COLUMNS).append(" FROM briefing_items")
                .append(" WHERE space_id = ?");
        List<Object> args = new ArrayList<>();
        args.add(spaceId);
        if (runId != null) {
            sql.append(" AND run_id = ?");
            args.add(runId);
        }
        if (theme != null && !theme.isBlank()) {
            sql.append(" AND theme = ?");
            args.add(theme);
        }
        if (minScore != null) {
            sql.append(" AND quality_score >= ?");
            args.add(minScore);
        }
        if (query != null && !query.isBlank()) {
            sql.append(" AND (title LIKE ? OR summary LIKE ?)");
            String like = "%" + query.trim() + "%";
            args.add(like);
            args.add(like);
        }
        sql.append(" ORDER BY quality_score DESC, rank ASC LIMIT ? OFFSET ?");
        args.add(size);
        args.add((page - 1) * size);
        return jdbc.query(sql.toString(), MAPPER, args.toArray());
    }

    public int upsertFeedback(long spaceId, long userId, String url, String feedback, String now) {
        return jdbc.update("INSERT INTO briefing_feedback (space_id, user_id, url, feedback, updated_at)"
                        + " VALUES (?, ?, ?, ?, ?) ON CONFLICT(space_id, user_id, url) DO UPDATE SET"
                        + " feedback = excluded.feedback, updated_at = excluded.updated_at",
                spaceId, userId, url, feedback, now);
    }

    public Map<String, Integer> usefulCounts(long spaceId) {
        Map<String, Integer> result = new HashMap<>();
        jdbc.query("SELECT url, COUNT(*) c FROM briefing_feedback WHERE space_id = ? AND feedback = 'useful'"
                + " GROUP BY url", rs -> {
            result.put(rs.getString("url"), rs.getInt("c"));
        }, spaceId);
        return result;
    }
}

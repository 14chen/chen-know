package com.kb.quality;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 质量报告的数据访问：扫描缓存 + 落评分结果。所有查询都带 space_id。 */
@Repository
public class QualityReportRepository {

    private final JdbcTemplate jdbc;

    public QualityReportRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Row(String url, String title, String summary) {
    }

    /** 从 briefing_cache 扫描（每 URL 一行，避免扫正文大字段）。 */
    public List<Row> briefingRows(long spaceId, int limit) {
        return jdbc.query("SELECT url, title_zh, summary_zh FROM briefing_cache WHERE space_id = ?"
                        + " ORDER BY COALESCE(updated_at, created_at) DESC LIMIT ?",
                (rs, n) -> new Row(rs.getString("url"), rs.getString("title_zh"), rs.getString("summary_zh")),
                spaceId, Math.max(1, limit));
    }

    public void save(long spaceId, String module, String targetKey, QualityResult result, String now) {
        jdbc.update("INSERT INTO content_quality (space_id, module, target_key, score, accepted, reasons,"
                        + " checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
                        + " ON CONFLICT(space_id, module, target_key) DO UPDATE SET score = excluded.score,"
                        + " accepted = excluded.accepted, reasons = excluded.reasons,"
                        + " checked_at = excluded.checked_at",
                spaceId, module, targetKey, result.score(), result.accepted() ? 1 : 0,
                String.join(" | ", result.reasons()), now);
    }
}

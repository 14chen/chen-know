package com.kb.ops;

import com.kb.common.Times;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** 元数据滚动清理；dry-run 只统计不删除。白名单表，绝不碰 notes / runs 历史。 */
@Service
public class RetentionService {

    private static final Logger log = LoggerFactory.getLogger(RetentionService.class);

    private record Target(String table, String column, int days) {}

    private final JdbcTemplate jdbc;
    private final RetentionProperties properties;

    public RetentionService(JdbcTemplate jdbc, RetentionProperties properties) {
        this.jdbc = jdbc;
        this.properties = properties;
    }

    /** @return 每张表的 {删除条数}，dryRun 时为「将会删除」的条数 */
    public Map<String, Integer> clean(boolean dryRun) {
        Map<String, Integer> result = new LinkedHashMap<>();
        for (Target target : targets()) {
            String cutoff = Times.format(Instant.now().minus(Duration.ofDays(target.days())));
            String where = " WHERE " + target.column() + " < ?";
            int count = jdbc.queryForObject("SELECT COUNT(*) FROM " + target.table() + where,
                    Integer.class, cutoff);
            if (!dryRun && count > 0) {
                jdbc.update("DELETE FROM " + target.table() + where, cutoff);
            }
            result.put(target.table(), count);
        }
        log.info("元数据保留清理: dryRun={} 明细={}", dryRun, result);
        return result;
    }

    private java.util.List<Target> targets() {
        return java.util.List.of(
                new Target("briefing_cache", "COALESCE(updated_at, created_at)", properties.getCacheDays()),
                new Target("briefing_seen", "first_seen_at", properties.getSeenDays()),
                new Target("run_metrics", "created_at", properties.getMetricsDays()),
                new Target("run_progress", "updated_at", properties.getMetricsDays()),
                new Target("source_health", "updated_at", properties.getHealthDays()),
                new Target("content_quality", "checked_at", properties.getQualityDays()),
                new Target("ai_analysis", "created_at", properties.getAiDays()),
                new Target("repo_star_snapshots", "captured_at", properties.getWeeklyDays()),
                new Target("weekly_project_weeks", "created_at", properties.getWeeklyDays()),
                new Target("weekly_project_profiles", "updated_at", properties.getWeeklyDays()));
    }
}

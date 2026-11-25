package com.kb.weekly;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** weekly_project_weeks / weekly_project_profiles 与 star 历史的数据访问。 */
@Repository
public class WeeklyExperienceRepository {

    private final JdbcTemplate jdbc;

    public WeeklyExperienceRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record ProjectWeek(String isoWeek, String source, String repo, String title, Long noteId, String url,
            Integer totalStars, Integer weeklyStars, String language, int rank, String theme,
            Integer openIssues, Integer forks) {
    }

    public record WeekRow(String isoWeek, int projects) {
    }

    public record Profile(String source, String repo, String firstSeenWeek, String lastSeenWeek,
            int consecutiveWeeks, Integer bestWeeklyGrowth) {
    }

    public record StarPoint(String capturedAt, long stars, Integer delta) {
    }

    public void insertWeek(long spaceId, String isoWeek, String source, String repo, String title, Long noteId,
            String url, Integer totalStars, Integer weeklyStars, String language, int rank, String theme,
            String now, Integer openIssues, Integer forks) {
        jdbc.update("INSERT OR REPLACE INTO weekly_project_weeks (space_id, iso_week, source, repo, title,"
                        + " note_id, url, total_stars, weekly_stars, language, rank, theme, created_at,"
                        + " open_issues, forks)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                spaceId, isoWeek, source, repo, title, noteId, url, totalStars, weeklyStars, language,
                rank, theme, now, openIssues, forks);
    }

    /** 新项目插入；老项目更新连续周数与最高周增。consecutive 由服务层按 ISO 周推算。 */
    public void upsertProfile(long spaceId, String source, String repo, String isoWeek, int consecutive,
            Integer weeklyStars, String now) {
        jdbc.update("INSERT INTO weekly_project_profiles (space_id, source, repo, first_seen_week,"
                        + " last_seen_week, consecutive_weeks, best_weekly_growth, updated_at)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                        + " ON CONFLICT(space_id, source, repo) DO UPDATE SET last_seen_week = excluded.last_seen_week,"
                        + " consecutive_weeks = excluded.consecutive_weeks,"
                        + " best_weekly_growth = CASE WHEN excluded.best_weekly_growth IS NULL"
                        + " THEN weekly_project_profiles.best_weekly_growth"
                        + " WHEN weekly_project_profiles.best_weekly_growth IS NULL"
                        + " THEN excluded.best_weekly_growth"
                        + " ELSE MAX(weekly_project_profiles.best_weekly_growth, excluded.best_weekly_growth) END,"
                        + " updated_at = excluded.updated_at",
                spaceId, source, repo, isoWeek, isoWeek, consecutive, weeklyStars, now);
    }

    public Optional<Profile> profile(long spaceId, String source, String repo) {
        return jdbc.query("SELECT source, repo, first_seen_week, last_seen_week, consecutive_weeks,"
                        + " best_weekly_growth FROM weekly_project_profiles"
                        + " WHERE space_id = ? AND source = ? AND repo = ?",
                (rs, n) -> new Profile(rs.getString("source"), rs.getString("repo"),
                        rs.getString("first_seen_week"), rs.getString("last_seen_week"),
                        rs.getInt("consecutive_weeks"), (Integer) rs.getObject("best_weekly_growth")),
                spaceId, source, repo).stream().findFirst();
    }

    public List<WeekRow> weeks(long spaceId) {
        return jdbc.query("SELECT iso_week, COUNT(*) projects FROM weekly_project_weeks WHERE space_id = ?"
                + " GROUP BY iso_week ORDER BY iso_week DESC",
                (rs, n) -> new WeekRow(rs.getString("iso_week"), rs.getInt("projects")), spaceId);
    }

    public List<ProjectWeek> weekProjects(long spaceId, String isoWeek) {
        return jdbc.query("SELECT iso_week, source, repo, title, note_id, url, total_stars, weekly_stars,"
                        + " language, rank, theme, open_issues, forks FROM weekly_project_weeks"
                        + " WHERE space_id = ? AND iso_week = ? ORDER BY rank ASC",
                (rs, n) -> {
                    long noteRaw = rs.getLong("note_id");
                    Long noteId = rs.wasNull() ? null : noteRaw;
                    return new ProjectWeek(rs.getString("iso_week"), rs.getString("source"), rs.getString("repo"),
                        rs.getString("title"), noteId, rs.getString("url"),
                        (Integer) rs.getObject("total_stars"), (Integer) rs.getObject("weekly_stars"),
                        rs.getString("language"), rs.getInt("rank"), rs.getString("theme"),
                        (Integer) rs.getObject("open_issues"), (Integer) rs.getObject("forks"));
                },
                spaceId, isoWeek);
    }

    /** 快照按时间升序返回；delta 由服务层用相邻两点计算。 */
    public List<StarPoint> starHistory(long spaceId, String source, String repo, int limit) {
        List<StarPoint> points = new ArrayList<>(jdbc.query("SELECT captured_at, stars FROM repo_star_snapshots"
                        + " WHERE space_id = ? AND source = ? AND repo = ? ORDER BY captured_at DESC LIMIT ?",
                (rs, n) -> new StarPoint(rs.getString("captured_at"), rs.getLong("stars"), null),
                spaceId, source, repo, Math.max(2, Math.min(limit, 52))));
        java.util.Collections.reverse(points);
        for (int i = 1; i < points.size(); i++) {
            StarPoint previous = points.get(i - 1);
            StarPoint current = points.get(i);
            points.set(i, new StarPoint(current.capturedAt(), current.stars(),
                    (int) (current.stars() - previous.stars())));
        }
        return points;
    }
}

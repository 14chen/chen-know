package com.kb.weekly;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * star 快照：Gitee 拿不到官方周增，只能自己存每次运行的 stars，
 * 下次用「本次 - 7 天前最接近的一次」算真实周增。
 */
@Repository
public class RepoStarSnapshots {

    private final JdbcTemplate jdbc;

    public RepoStarSnapshots(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void record(long spaceId, String source, String repo, long stars, String capturedAt) {
        jdbc.update("INSERT OR REPLACE INTO repo_star_snapshots"
                + " (space_id, source, repo, stars, captured_at) VALUES (?, ?, ?, ?, ?)",
                spaceId, source, repo, stars, capturedAt);
    }

    /**
     * 取不晚于 {@code atOrBefore} 的最近一次快照的 stars。
     *
     * @return 空表示「没有可比的历史快照」→ 周增显示「—（首次收录，下周起显示）」
     */
    public Optional<Long> starsAtOrBefore(long spaceId, String source, String repo, String atOrBefore) {
        return jdbc.query("SELECT stars FROM repo_star_snapshots WHERE space_id = ? AND source = ?"
                        + " AND repo = ? AND captured_at <= ? ORDER BY captured_at DESC LIMIT 1",
                (rs, rowNum) -> rs.getLong("stars"), spaceId, source, repo, atOrBefore).stream().findFirst();
    }

    public int count(long spaceId) {
        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM repo_star_snapshots WHERE space_id = ?",
                Integer.class, spaceId);
        return total == null ? 0 : total;
    }
}

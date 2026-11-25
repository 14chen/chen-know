package com.kb.briefing;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 翻译 / 文章页 / 配图的缓存（表 {@code briefing_cache}）。
 *
 * <p>同一个 URL 第二天再上榜时不再重复翻译、不再重复抓文章页、也不再重复下载图片。
 * 两条关键语义（DEF：失败翻译天天重试 / 缓存永久不过期）：
 * <ul>
 *   <li>{@code translation_failed=1} 的条目只算「页和图片缓存」，翻译仍会重试；成功后即清掉标志。</li>
 *   <li>{@code find} 只认 {@code updated_at}（老库回退 {@code created_at}）不早于 TTL 截止时间的条目。</li>
 * </ul>
 */
@Repository
public class BriefingCache {

    private final JdbcTemplate jdbc;

    public BriefingCache(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** @param attachmentId 已落库的本地附件 id（null 表示这篇没有图/没下载成功） */
    public record Entry(String titleZh, String summaryZh, String imageUrl, Long attachmentId,
            boolean translationFailed) {

        static final Entry EMPTY = new Entry(null, null, null, null, false);

        public Entry withTranslations(String title, String summary, boolean failed) {
            return new Entry(title, summary, imageUrl, attachmentId, failed);
        }

        public Entry withImage(String remote, Long id) {
            return new Entry(titleZh, summaryZh, remote == null ? "" : remote, id, translationFailed);
        }
    }

    /** TTL 感知读取：过期条目按未命中处理，交由调用方重抓/重译。 */
    public Optional<Entry> find(long spaceId, String url, String refreshedAfterIso) {
        return jdbc.query("SELECT title_zh, summary_zh, image_remote, attachment_id, translation_failed"
                        + " FROM briefing_cache WHERE space_id = ? AND url = ?"
                        + " AND COALESCE(updated_at, created_at) >= ?",
                (rs, rowNum) -> new Entry(rs.getString("title_zh"), rs.getString("summary_zh"),
                        rs.getString("image_remote"),
                        rs.getObject("attachment_id") == null ? null : rs.getLong("attachment_id"),
                        rs.getInt("translation_failed") != 0),
                spaceId, url, refreshedAfterIso).stream().findFirst();
    }

    /** 统一写回点：同一 URL 的译文、文章页、配图、翻译失败标志一次落库。 */
    public void save(long spaceId, String url, Entry entry, String now) {
        jdbc.update("INSERT INTO briefing_cache (space_id, url, title_zh, summary_zh, image_remote,"
                        + " attachment_id, created_at, updated_at, translation_failed)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                        + " ON CONFLICT(space_id, url) DO UPDATE SET title_zh = excluded.title_zh,"
                        + " summary_zh = excluded.summary_zh, image_remote = excluded.image_remote,"
                        + " attachment_id = excluded.attachment_id, updated_at = excluded.updated_at,"
                        + " translation_failed = excluded.translation_failed",
                spaceId, url, entry.titleZh(), entry.summaryZh(), entry.imageUrl(), entry.attachmentId(),
                now, now, entry.translationFailed() ? 1 : 0);
    }
}

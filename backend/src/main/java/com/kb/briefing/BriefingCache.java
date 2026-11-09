package com.kb.briefing;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 翻译 / 文章页 / 配图的缓存（表 {@code briefing_cache}）。
 *
 * <p>同一个 URL 第二天再上榜时不再重复翻译、不再重复抓文章页、也不再重复下载图片。
 */
@Repository
public class BriefingCache {

    private final JdbcTemplate jdbc;

    public BriefingCache(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** @param attachmentId 已落库的本地附件 id（null 表示这篇没有图/没下载成功） */
    public record Entry(String titleZh, String summaryZh, String imageUrl, Long attachmentId) {

        static final Entry EMPTY = new Entry(null, null, null, null);
    }

    public Optional<Entry> find(long spaceId, String url) {
        return jdbc.query("SELECT title_zh, summary_zh, image_remote, attachment_id FROM briefing_cache"
                        + " WHERE space_id = ? AND url = ?",
                (rs, rowNum) -> new Entry(rs.getString("title_zh"), rs.getString("summary_zh"),
                        rs.getString("image_remote"),
                        rs.getObject("attachment_id") == null ? null : rs.getLong("attachment_id")),
                spaceId, url).stream().findFirst();
    }

    public void save(long spaceId, String url, Entry entry, String createdAt) {
        jdbc.update("INSERT INTO briefing_cache (space_id, url, title_zh, summary_zh, image_remote,"
                        + " attachment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
                        + " ON CONFLICT(space_id, url) DO UPDATE SET title_zh = excluded.title_zh,"
                        + " summary_zh = excluded.summary_zh, image_remote = excluded.image_remote,"
                        + " attachment_id = excluded.attachment_id",
                spaceId, url, entry.titleZh(), entry.summaryZh(), entry.imageUrl(), entry.attachmentId(),
                createdAt);
    }
}

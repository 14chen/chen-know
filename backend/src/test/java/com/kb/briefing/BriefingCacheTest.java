package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** 简报缓存的 TTL 与「失败待重试」语义（P0：失败翻译不能写死进缓存）。 */
@SpringBootTest
class BriefingCacheTest {

    private static final Path DATA_DIR = tempDir();

    private static Path tempDir() {
        try {
            return Files.createTempDirectory("kb-briefing-cache");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @Autowired
    private BriefingCache cache;

    @Autowired
    private BriefingRepository repository;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("翻译失败写进 translation_failed，但下一次 find 仍返回『可重试』标记")
    void failedTranslationIsMarkedForRetry() {
        String url = "https://example.com/retry-" + System.nanoTime();
        cache.save(42L, url, new BriefingCache.Entry(null, null, "", null, true),
                "2026-11-22T10:00:00Z");

        BriefingCache.Entry found = cache.find(42L, url, "2026-11-01T00:00:00Z").orElseThrow();
        assertTrue(found.translationFailed(), "失败条目必须标记为待重试");
        assertEquals("", found.imageUrl(), "文章页『看过但没图』的哨兵仍要保留");

        cache.save(42L, url, new BriefingCache.Entry("中文标题", "中文摘要", "", null, false),
                "2026-11-22T11:00:00Z");
        BriefingCache.Entry fixed = cache.find(42L, url, "2026-11-01T00:00:00Z").orElseThrow();
        assertEquals("中文标题", fixed.titleZh());
        assertTrue(!fixed.translationFailed(), "成功后清除失败标记");
    }

    @Test
    @DisplayName("TTL 截止前的缓存命中，早于截止时间的按未命中处理")
    void ttlCutoff() {
        String url = "https://example.com/ttl-" + System.nanoTime();
        cache.save(42L, url, new BriefingCache.Entry("标题", "摘要", null, null, false),
                "2026-11-01T00:00:00Z");

        assertTrue(cache.find(42L, url, "2026-10-01T00:00:00Z").isPresent(), "未过期应命中");
        assertTrue(cache.find(42L, url, "2026-12-01T00:00:00Z").isEmpty(), "过期应视为未命中");
    }

    @Test
    @DisplayName("滚动清理：过期缓存行与过期去重记录都被删除")
    void purgeExpiredRows() {
        long spaceId = 9000L + System.nanoTime() % 1000;
        String url = "https://example.com/purge-" + System.nanoTime();
        cache.save(spaceId, url, new BriefingCache.Entry("标题", "摘要", null, null, false),
                "2026-01-01T00:00:00Z");
        repository.markSeen(spaceId, java.util.List.of(url), "2026-01-01T00:00:00Z");

        assertEquals(1, repository.purgeExpiredCache(spaceId, "2026-06-01T00:00:00Z"));
        assertEquals(1, repository.purgeOldSeen(spaceId, "2026-06-01T00:00:00Z"));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM briefing_cache WHERE space_id = ?",
                Integer.class, spaceId));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM briefing_seen WHERE space_id = ?",
                Integer.class, spaceId));
    }
}

package com.kb.search;

import java.util.LinkedHashMap;
import java.util.Map;
import com.kb.db.SqliteDataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 搜索结果短缓存（DEF-E3-002）。
 *
 * <p>搜索是纯读且开销与命中数成正比（1 万篇命中时单次要 200–500ms，瓶颈在 FTS5 的 bm25 排序），
 * 并发下重复的相同查询会互相抢 CPU。这里做一个**有界 + 可正确失效**的短缓存：
 *
 * <ul>
 *   <li>键 = 空间 + 检索表达式 + 词 + 全部筛选 + 分页，值 = 一页结果与总数；</li>
 *   <li>失效靠 SQLite 的 {@code PRAGMA data_version}：库被**其它连接**改动时该值会自增，
 *       因此「新建/修改/删除笔记后立即搜索」不会读到旧结果；</li>
 *   <li>再叠加一个很短的 TTL（默认 3s）兜住「同一连接写后再读」这类边界，并让长期不写入的空表
 *       不会无限期缓存；</li>
 *   <li>LRU 上限 128 条，避免内存随查询花样增长。</li>
 * </ul>
 *
 * <p>参数：{@code kb.search.cache-size}（默认 128，0 = 关闭）、{@code kb.search.cache-ttl-ms}（默认 3000）。
 */
@Component
public class SearchResultCache {

    private final JdbcTemplate jdbcTemplate;
    private final int maxSize = Integer.getInteger("kb.search.cache-size", 128);
    private final long ttlMs = Long.getLong("kb.search.cache-ttl-ms", 3_000L);
    private final Map<String, Entry> cache;

    private record Entry(SearchRepository.SearchPage page, long epoch, int dataVersion, long expiresAt) {
    }

    public SearchResultCache(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
        this.cache = new LinkedHashMap<>(32, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Entry> eldest) {
                return size() > Math.max(1, maxSize);
            }
        };
    }

    /** 键：同一查询（含分页）才可能复用。 */
    public static String key(long spaceId, SearchQuery query) {
        return spaceId + '|' + query.matchExpression() + '|' + String.join("\u0001", query.terms())
                + '|' + query.folderId() + '|' + query.tag() + '|' + query.tagId()
                + '|' + query.from() + '|' + query.to() + '|' + query.sort()
                + '|' + query.page() + '|' + query.size();
    }

    public boolean enabled() {
        return maxSize > 0 && ttlMs > 0;
    }

    public SearchRepository.SearchPage get(String key) {
        if (!enabled()) {
            return null;
        }
        Entry entry;
        synchronized (cache) {
            entry = cache.get(key);
        }
        if (entry == null) {
            return null;
        }
        if (entry.expiresAt() < System.currentTimeMillis()) {
            synchronized (cache) {
                cache.remove(key);
            }
            return null;
        }
        if (entry.epoch() != writeEpoch() || entry.dataVersion() != dataVersion()) {
            synchronized (cache) {
                cache.remove(key);
            }
            return null;
        }
        return entry.page();
    }

    public void put(String key, SearchRepository.SearchPage page) {
        if (!enabled()) {
            return;
        }
        Entry entry = new Entry(page, writeEpoch(), dataVersion(), System.currentTimeMillis() + ttlMs);
        synchronized (cache) {
            cache.put(key, entry);
        }
    }

    public void clear() {
        synchronized (cache) {
            cache.clear();
        }
    }

    /** 本进程内任一连接写过的次数（{@link SqliteDataSource#writeEpoch()}，覆盖"同连接写后再读"）。 */
    private static long writeEpoch() {
        return SqliteDataSource.writeEpoch();
    }

    /** 库内容的版本号：其它连接提交写操作后自增（跨连接写的兜底）。 */
    int dataVersion() {
        try {
            Integer version = jdbcTemplate.queryForObject("PRAGMA data_version", Integer.class);
            return version == null ? -1 : version;
        } catch (RuntimeException e) {
            return -1;
        }
    }
}
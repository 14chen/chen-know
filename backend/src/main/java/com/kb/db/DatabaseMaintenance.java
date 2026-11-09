package com.kb.db;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 数据库维护：空间回收 + 超长全文索引收敛（DEF-E3-005）。
 *
 * <p>背景：SQLite 删除大对象后不会把页还给操作系统，{@code notes} 里 1–2MB 的正文删掉之后
 * 库文件只涨不落。修复分两步：
 * <ol>
 *   <li>{@link SchemaMigrator} 在建表前把 {@code auto_vacuum} 设为 {@code INCREMENTAL}
 *       （旧库需要一次 {@code VACUUM} 才生效，已在迁移里处理）；</li>
 *   <li>本类按固定间隔执行 {@code PRAGMA incremental_vacuum} 把空闲页真正还给文件系统，
 *       同时做一次 {@code wal_checkpoint(PASSIVE)}，让 -wal 里的内容落回主库。</li>
 * </ol>
 *
 * <p>超长 {@code search_blob} 的收敛在 {@link SchemaMigrator} 里一次性完成（重建 FTS 索引），
 * 之后的写入由带 {@code substr} 的触发器兜住。
 *
 * <p>参数（系统属性，均有默认值，不需要改 application.properties）：
 * {@code kb.db.maintenance}（true/false，总开关）、
 * {@code kb.db.maintenance-interval-ms}（默认 60000）、
 * {@code kb.db.fts-blob-limit}（默认 32768 字符）。
 */
@Component
public class DatabaseMaintenance implements InitializingBean, DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(DatabaseMaintenance.class);

    static final int FTS_BLOB_LIMIT = Integer.getInteger("kb.db.fts-blob-limit", 32768);
    /** 空闲页超过这个数才真正回收，避免每次空转。 */
    private static final int FREELIST_THRESHOLD = 32;
    /** 空闲页多到这个量级（约 2MB）且增量回收无效时，才做一次整库 VACUUM。 */
    private static final int VACUUM_THRESHOLD = 512;
    /** 整库 VACUUM 的最小间隔，避免频繁重写文件。 */
    private static final long VACUUM_MIN_INTERVAL_MS =
            Long.getLong("kb.db.vacuum-interval-ms", 600_000L);
    private final java.util.concurrent.atomic.AtomicLong lastVacuumAt =
            new java.util.concurrent.atomic.AtomicLong();

    private final JdbcTemplate jdbcTemplate;
    private final boolean enabled = !"false".equalsIgnoreCase(System.getProperty("kb.db.maintenance", "true"));
    private final long intervalMs = Long.getLong("kb.db.maintenance-interval-ms", 60_000L);
    private ScheduledExecutorService scheduler;

    public DatabaseMaintenance(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void afterPropertiesSet() {
        if (!enabled) {
            log.info("数据库维护任务已关闭（kb.db.maintenance=false）");
            return;
        }
        scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "kb-db-maintenance");
            t.setDaemon(true);
            return t;
        });
        scheduler.scheduleWithFixedDelay(this::tick, 2_000L, Math.max(5_000L, intervalMs), TimeUnit.MILLISECONDS);
        log.info("数据库维护任务已启动：间隔 {}ms，FTS 索引正文上限 {} 字符", Math.max(5_000L, intervalMs),
                FTS_BLOB_LIMIT);
    }

    /** 一轮维护：索引收敛 → 检查点 → 空间回收。任何异常都不允许影响业务线程。 */
    void tick() {
        try {
            // 先把 -wal 里的内容并回主库并把 wal 截断，否则空闲页还留在 wal 里，主库文件缩不下去
            jdbcTemplate.execute("PRAGMA wal_checkpoint(TRUNCATE)");
        } catch (RuntimeException e) {
            log.debug("wal_checkpoint(TRUNCATE) 未完成，回退 PASSIVE: {}", e.getMessage());
            try {
                jdbcTemplate.execute("PRAGMA wal_checkpoint(PASSIVE)");
            } catch (RuntimeException ignored) {
                // 有活跃读者时检查点失败是正常的，下一轮再试
            }
        }
        try {
            Integer free = jdbcTemplate.queryForObject("PRAGMA freelist_count", Integer.class);
            if (free != null && free >= FREELIST_THRESHOLD) {
                jdbcTemplate.execute("PRAGMA incremental_vacuum");
                Integer left = jdbcTemplate.queryForObject("PRAGMA freelist_count", Integer.class);
                log.info("incremental_vacuum 回收空闲页：{} -> {}", free, left);
                // 实测：auto_vacuum=INCREMENTAL 下 incremental_vacuum 每轮通常只挪得动 1 页
                //（空闲页不在文件尾部时无法截断），因此空闲页仍然很多时用一次整库 VACUUM 兜底。
                if (left != null && left >= VACUUM_THRESHOLD && idleLongEnough()) {
                    vacuum();
                }
            }
        } catch (RuntimeException e) {
            log.warn("incremental_vacuum 失败: {}", e.getMessage());
        }
    }

        private boolean idleLongEnough() {
        long last = lastVacuumAt.get();
        return last == 0 || System.currentTimeMillis() - last >= VACUUM_MIN_INTERVAL_MS;
    }

    /**
     * 整库 VACUUM：把碎片与空闲页一次性还给文件系统。
     *
     * <p>代价是短暂独占库并需要临时空间，所以只在"空闲页确实回收不动 + 距上次超过
     * {@code kb.db.vacuum-interval-ms}（默认 10 分钟）"时才跑；失败（有活跃事务）下一轮重试。
     */
    void vacuum() {
        if (!lastVacuumAt.compareAndSet(lastVacuumAt.get(), System.currentTimeMillis())) {
            return;
        }
        long before = fileSize();
        try {
            jdbcTemplate.execute("VACUUM");
            log.info("VACUUM 完成：库文件 {} MB -> {} MB", before / 1048576, fileSize() / 1048576);
        } catch (RuntimeException e) {
            lastVacuumAt.set(0);
            log.warn("VACUUM 未完成（可能有活跃事务），下一轮重试: {}", e.getMessage());
        }
    }

    private long fileSize() {
        try {
            String path = jdbcTemplate.queryForObject("PRAGMA database_list", (rs, rowNum) -> rs.getString("file"));
            return path == null ? -1 : java.nio.file.Files.size(java.nio.file.Path.of(path));
        } catch (Exception e) {
            return -1;
        }
    }

    /** 显式回收入口：需要立刻归还空间时调用（例如运维脚本、管理端点）。 */
    public void reclaimNow() {
        tick();
    }

    @Override
    public void destroy() {
        if (scheduler != null) {
            scheduler.shutdownNow();
        }
    }
}
package com.kb.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.kb.common.SearchText;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 并发写回归：Spring 默认的 DEFERRED 事务在「读快照 → 升级写锁」时会抛
 * SQLITE_BUSY_SNAPSHOT（且 busy_timeout 对它无效，必须立即返回），并发保存笔记大概率 500。
 *
 * <p>{@link SqliteDataSource} 已强制 {@code BEGIN IMMEDIATE}，本测试把这三件事钉住：
 * 事务起始即持写锁、多线程事务写全部成功、读不被未提交的写事务阻塞。
 */
class SqliteTransactionModeTest {

    private static final String NOW = "2026-10-16T02:33:14Z";

    @TempDir
    Path tempDir;

    private SqliteDataSource dataSource;
    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() throws Exception {
        dataSource = new SqliteDataSource("jdbc:sqlite:" + tempDir.resolve("concurrency.db"));
        jdbc = new JdbcTemplate(dataSource);
        new SchemaMigrator(jdbc).afterPropertiesSet();
        jdbc.update("INSERT INTO users (username, display_name, password_hash, role, created_at)"
                + " VALUES ('concurrency', '并发', 'hash', 'admin', ?)", NOW);
        jdbc.update("INSERT INTO spaces (owner_id, name, created_at)"
                + " SELECT id, '并发空间', ? FROM users", NOW);
    }

    private int insertNote(String title) {
        return jdbc.update("INSERT INTO notes (space_id, title, content, search_blob, created_at, updated_at)"
                + " SELECT id, ?, ?, ?, ?, ? FROM spaces", title, "正文 " + title,
                SearchText.normalize(title + " 正文"), NOW, NOW);
    }

    @Test
    @DisplayName("事务一开始就持有写锁（BEGIN IMMEDIATE 的行为特征）")
    void writeLockIsHeldRightAfterBegin() throws Exception {
        try (Connection holder = dataSource.getConnection(); Connection other = dataSource.getConnection()) {
            // other 的连接超时调短，避免测试等 5 秒
            try (Statement statement = other.createStatement()) {
                statement.execute("PRAGMA busy_timeout=200");
            }

            holder.setAutoCommit(false);
            // DEFERRED 时这一步什么都没锁；IMMEDIATE 时已经持有 RESERVED 写锁
            SQLException failure = assertThrows(SQLException.class, () -> {
                try (Statement statement = other.createStatement()) {
                    statement.execute("INSERT INTO notes (space_id, title, content, created_at, updated_at)"
                            + " SELECT id, 'x', 'y', '" + NOW + "', '" + NOW + "' FROM spaces");
                }
            });
            assertTrue(failure.getMessage().contains("BUSY"), "期望 SQLITE_BUSY，实际：" + failure.getMessage());

            holder.rollback();
            holder.setAutoCommit(true);

            // 写事务结束后，别的连接立刻能写
            // 注意：notes 上有 FTS5 触发器，executeUpdate() 的返回值会把触发器/影子表的改动也算进去
            // （实测插入 1 篇返回 4），所以这里用 SELECT COUNT 校验，不看返回值。
            int before = jdbc.queryForObject("SELECT COUNT(*) FROM notes", Integer.class);
            try (Statement statement = other.createStatement()) {
                statement.execute("INSERT INTO notes (space_id, title, content, created_at, updated_at)"
                        + " SELECT id, 'x', 'y', '" + NOW + "', '" + NOW + "' FROM spaces");
            }
            assertEquals(before + 1, jdbc.queryForObject("SELECT COUNT(*) FROM notes", Integer.class));
        }
    }

    @Test
    @DisplayName("12 线程并发事务写同一张表：全部成功（复刻真实写路径：先读再写）")
    void concurrentTransactionalWritesAllSucceed() throws Exception {
        int threads = 12;
        TransactionTemplate transaction =
                new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch startTogether = new CountDownLatch(1);
        List<Future<?>> results = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                String title = "并发-" + i;
                results.add(pool.submit(() -> {
                    startTogether.await();
                    transaction.execute(status -> {
                        // 真实写路径就是这样：事务里先 SELECT（建立读快照），再 INSERT
                        Integer before = jdbc.queryForObject("SELECT COUNT(*) FROM notes", Integer.class);
                        assertTrue(before != null);
                        return insertNote(title);
                    });
                    return null;
                }));
            }
            startTogether.countDown();
            for (Future<?> result : results) {
                result.get(60, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
        assertEquals(threads, jdbc.queryForObject("SELECT COUNT(*) FROM notes", Integer.class),
                "并发写应当全部落库，一篇都不能丢");
    }

    @Test
    @DisplayName("未提交的写事务不阻塞读（WAL + IMMEDIATE 下读并发不受影响）")
    void readsAreNotBlockedByOpenWriteTransaction() throws Exception {
        try (Connection writer = dataSource.getConnection()) {
            writer.setAutoCommit(false);
            try (Statement statement = writer.createStatement()) {
                statement.execute("INSERT INTO notes (space_id, title, content, created_at, updated_at)"
                        + " SELECT id, '未提交', 'x', '" + NOW + "', '" + NOW + "' FROM spaces");
            }
            try (Connection reader = dataSource.getConnection(); Statement statement = reader.createStatement()) {
                long began = System.nanoTime();
                try (ResultSet resultSet = statement.executeQuery("SELECT COUNT(*) FROM notes")) {
                    resultSet.next();
                    assertEquals(0, resultSet.getInt(1), "读连接应看到未提交前的快照");
                }
                long elapsedMillis = (System.nanoTime() - began) / 1_000_000;
                assertTrue(elapsedMillis < 1000, "读被写事务挡了 " + elapsedMillis + "ms");
            }
            writer.rollback();
        }
    }
}

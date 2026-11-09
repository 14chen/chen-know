package com.kb.db;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 启动时执行 {@code db/schema.sql}。DDL 全部 {@code IF NOT EXISTS}，可重复执行。
 *
 * <p>实现 {@link InitializingBean} 而非 ApplicationRunner：迁移在容器刷新阶段完成，
 * 早于任何请求进入业务代码。
 */
@Component
public class SchemaMigrator implements InitializingBean {

    private static final Logger log = LoggerFactory.getLogger(SchemaMigrator.class);
    private static final String SCHEMA_RESOURCE = "db/schema.sql";

    /**
     * 追加式 DDL（不改 schema.sql，避免与其它流的 DDL 计数口径打架）。
     *
     * <p>{@code idx_notes_created}（DEF-E3-003 / C 流统计接口所需）：{@code /api/stats} 的 daily 分支
     * 按 {@code (space_id, deleted_at, created_at)} 聚合，有这条覆盖索引就不必回表，
     * C 流实测 113.55ms → 6.54ms。
     */
    private static final String[] EXTRA_DDL = {
            "CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(space_id, deleted_at, created_at)",
    };

    /**
     * 幂等补列：缺就 {@code ALTER TABLE ... ADD COLUMN}，已有则什么都不做。
     *
     * @return true 表示这次真的加了列
     */
    private boolean ensureColumn(String table, String column, String definition) {
        Boolean present = jdbcTemplate.query("PRAGMA table_info(" + table + ")", rs -> {
            boolean found = false;
            while (rs.next()) {
                if (column.equalsIgnoreCase(rs.getString("name"))) {
                    found = true;
                }
            }
            return found;
        });
        if (Boolean.TRUE.equals(present)) {
            return false;
        }
        jdbcTemplate.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
        log.info("迁移: 给表 {} 追加列 {}", table, column);
        return true;
    }

    /** BRIEFING.md §2：简报运行记录与跨天去重表（追加式迁移，不放进 schema.sql）。 */
    private static final String[] BRIEFING_DDL = {
            """
            CREATE TABLE IF NOT EXISTS briefing_runs (
              id            INTEGER PRIMARY KEY AUTOINCREMENT,
              space_id      INTEGER NOT NULL,
              started_at    TEXT    NOT NULL,
              finished_at   TEXT,
              status        TEXT    NOT NULL,
              note_id       INTEGER,
              total_items   INTEGER NOT NULL DEFAULT 0,
              new_items     INTEGER NOT NULL DEFAULT 0,
              source_report TEXT    NOT NULL DEFAULT '[]',
              error         TEXT
            )""",
            "CREATE INDEX IF NOT EXISTS idx_briefing_runs_space ON briefing_runs(space_id, started_at DESC)",
            """
            CREATE TABLE IF NOT EXISTS archive_runs (
              id            INTEGER PRIMARY KEY AUTOINCREMENT,
              space_id      INTEGER NOT NULL,
              started_at    TEXT    NOT NULL,
              finished_at   TEXT,
              status        TEXT    NOT NULL,
              moved_folders INTEGER NOT NULL DEFAULT 0,
              moved_notes   INTEGER NOT NULL DEFAULT 0,
              skipped       INTEGER NOT NULL DEFAULT 0,
              error         TEXT
            )""",
            "CREATE INDEX IF NOT EXISTS idx_archive_runs_space ON archive_runs(space_id, started_at DESC)",
            """
            CREATE TABLE IF NOT EXISTS repo_star_snapshots (
              space_id    INTEGER NOT NULL,
              source      TEXT    NOT NULL,
              repo        TEXT    NOT NULL,
              stars       INTEGER NOT NULL,
              captured_at TEXT    NOT NULL,
              PRIMARY KEY (space_id, source, repo, captured_at)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_repo_stars_lookup ON repo_star_snapshots"
                    + "(space_id, source, repo, captured_at DESC)",
            """
            CREATE TABLE IF NOT EXISTS weekly_runs (
              id            INTEGER PRIMARY KEY AUTOINCREMENT,
              space_id      INTEGER NOT NULL,
              iso_week      TEXT    NOT NULL,
              started_at    TEXT    NOT NULL,
              finished_at   TEXT,
              status        TEXT    NOT NULL,
              notes_created INTEGER NOT NULL DEFAULT 0,
              notes_skipped INTEGER NOT NULL DEFAULT 0,
              github_count  INTEGER NOT NULL DEFAULT 0,
              gitee_count   INTEGER NOT NULL DEFAULT 0,
              error         TEXT
            )""",
            "CREATE INDEX IF NOT EXISTS idx_weekly_runs_week ON weekly_runs(space_id, iso_week)",
            """
            CREATE TABLE IF NOT EXISTS briefing_cache (
              space_id      INTEGER NOT NULL,
              url           TEXT    NOT NULL,
              title_zh      TEXT,
              summary_zh    TEXT,
              image_remote  TEXT,
              attachment_id INTEGER,
              created_at    TEXT    NOT NULL,
              PRIMARY KEY (space_id, url)
            )""",
            """
            CREATE TABLE IF NOT EXISTS briefing_seen (
              space_id      INTEGER NOT NULL,
              url           TEXT    NOT NULL,
              first_seen_at TEXT    NOT NULL,
              PRIMARY KEY (space_id, url)
            )""",
    };

    private final JdbcTemplate jdbcTemplate;

    public SchemaMigrator(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void afterPropertiesSet() throws IOException {
        String script;
        try (InputStream in = new ClassPathResource(SCHEMA_RESOURCE).getInputStream()) {
            script = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        ensureIncrementalVacuum();
        List<String> statements = SqlScript.split(script);
        for (String statement : statements) {
            jdbcTemplate.execute(statement);
        }
        for (String statement : BRIEFING_DDL) {
            jdbcTemplate.execute(statement);
        }
        for (String statement : EXTRA_DDL) {
            jdbcTemplate.execute(statement);
        }
        int triggerDdl = installFtsTriggers();
        // 追加列的幂等迁移：SQLite 只能 ALTER TABLE ADD COLUMN；
        // 老库（weekly_runs 已存在但没有 notes_skipped）需要在这里补一次
        ensureColumn("weekly_runs", "notes_skipped", "INTEGER NOT NULL DEFAULT 0");
        capIndexedBlobs();
        log.info("数据库结构就绪，执行 {} 条 DDL",
                statements.size() + BRIEFING_DDL.length + EXTRA_DDL.length + triggerDdl);
    }

    /**
     * DEF-E3-005：把 auto_vacuum 切到 INCREMENTAL。
     *
     * <p>必须在建表（即第一次写入）之前设置才对**新库**生效；对已存在的库，
     * 修改 auto_vacuum 只写进文件头，需要一次 {@code VACUUM} 重建文件后才真正启用，
     * 所以这里读一次当前值，不是 INCREMENTAL 就切 + VACUUM（一次性，启动期完成）。
     */
    private void ensureIncrementalVacuum() {
        Integer before = jdbcTemplate.queryForObject("PRAGMA auto_vacuum", Integer.class);
        if (before != null && before == 2) {
            return;
        }
        jdbcTemplate.execute("PRAGMA auto_vacuum=INCREMENTAL");
        jdbcTemplate.execute("VACUUM");
        Integer after = jdbcTemplate.queryForObject("PRAGMA auto_vacuum", Integer.class);
        log.info("auto_vacuum 已切换为 INCREMENTAL（before={}, after={}，已执行一次性 VACUUM）", before, after);
    }

    /**
     * 一次性把历史索引里超长的正文收敛到 {@link DatabaseMaintenance#FTS_BLOB_LIMIT}。
     *
     * <p>不能用"逐行 delete + insert"：外部内容表的 delete 命令要求传入**当初被索引的那份文本**，
     * 而历史行是按全文索引的、新行是按截断索引的，两者混在一起逐行删会报
     * {@code SQLITE_CORRUPT_VTAB}。因此这里在升级时统一重建：{@code delete-all} 清空索引 →
     * 按截断规则重灌 → {@code PRAGMA user_version} 打标，只做一次。
     */
    private void capIndexedBlobs() {
        Integer version = jdbcTemplate.queryForObject("PRAGMA user_version", Integer.class);
        if (version != null && version >= 1) {
            return;
        }
        jdbcTemplate.execute("INSERT INTO notes_fts(notes_fts) VALUES('delete-all')");
        Integer inserted = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM (SELECT id FROM notes)", Integer.class);
        jdbcTemplate.update("INSERT INTO notes_fts(rowid, search_blob)"
                + " SELECT id, substr(search_blob, 1, " + DatabaseMaintenance.FTS_BLOB_LIMIT + ") FROM notes");
        jdbcTemplate.execute("PRAGMA user_version = 1");
        log.info("全文索引已按正文上限 {} 字符重建（notes 共 {} 条）",
                DatabaseMaintenance.FTS_BLOB_LIMIT, inserted);
    }

    /**
     * FTS5 外部内容表（{@code content='notes'}）的同步触发器：写入/更新/删除时按
     * {@link DatabaseMaintenance#FTS_BLOB_LIMIT} 截断正文，避免 1–2MB 的单篇正文把全文索引撑爆。
     *
     * <p>schema.sql 里已有一份不截断的同名触发器（{@code IF NOT EXISTS} 不会覆盖旧库），
     * 这里统一重建，保证新库与旧库行为一致。三个触发器必须用同一份截断规则，
     * 否则外部内容表的 delete 项与索引项对不上，会留下幽灵词。
     *
     * @return 实际执行的 DDL 条数
     */
    private int installFtsTriggers() {
        int limit = DatabaseMaintenance.FTS_BLOB_LIMIT;
        String[] ddl = {
                "DROP TRIGGER IF EXISTS notes_fts_ai",
                "DROP TRIGGER IF EXISTS notes_fts_ad",
                "DROP TRIGGER IF EXISTS notes_fts_au",
                "CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes BEGIN"
                        + " INSERT INTO notes_fts(rowid, search_blob)"
                        + " VALUES (new.id, substr(new.search_blob, 1, " + limit + ")); END",
                "CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes BEGIN"
                        + " INSERT INTO notes_fts(notes_fts, rowid, search_blob)"
                        + " VALUES ('delete', old.id, substr(old.search_blob, 1, " + limit + ")); END",
                "CREATE TRIGGER notes_fts_au AFTER UPDATE OF search_blob ON notes BEGIN"
                        + " INSERT INTO notes_fts(notes_fts, rowid, search_blob)"
                        + " VALUES ('delete', old.id, substr(old.search_blob, 1, " + limit + "));"
                        + " INSERT INTO notes_fts(rowid, search_blob)"
                        + " VALUES (new.id, substr(new.search_blob, 1, " + limit + ")); END"
        };
        for (String statement : ddl) {
            jdbcTemplate.execute(statement);
        }
        return ddl.length;
    }
}

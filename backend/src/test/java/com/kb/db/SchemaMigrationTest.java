package com.kb.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.kb.common.SearchText;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;

/** schema.sql 必须能反复执行，且 PRAGMA / 触发器 / 级联删除全部真实生效。 */
class SchemaMigrationTest {

    @TempDir
    Path tempDir;

    private JdbcTemplate newJdbcTemplate() {
        Path databaseFile = tempDir.resolve("kb.db");
        return new JdbcTemplate(new SqliteDataSource("jdbc:sqlite:" + databaseFile.toAbsolutePath()));
    }

    private static String schemaScript() throws IOException {
        try (var in = new ClassPathResource("db/schema.sql").getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    @DisplayName("切分器：FTS5 触发器整体保留，不被分号切坏")
    void splitterKeepsTriggerBodiesIntact() throws IOException {
        List<String> statements = SqlScript.split(schemaScript());
        assertTrue(statements.size() >= 26, "语句数偏少，可能被切坏了: " + statements.size());
        List<String> triggers = statements.stream().filter(s -> s.startsWith("CREATE TRIGGER")).toList();
        assertEquals(3, triggers.size());
        for (String trigger : triggers) {
            assertTrue(trigger.contains("BEGIN"), trigger);
            assertTrue(trigger.trim().endsWith("END"), trigger);
            assertTrue(trigger.contains("notes_fts"), trigger);
        }
        // 注释不应产出「空语句」
        assertTrue(statements.stream().noneMatch(s -> s.startsWith("--")));
    }

    @Test
    @DisplayName("迁移幂等：连跑两次不报错，表/触发器齐全")
    void migrationIsIdempotent() throws Exception {
        JdbcTemplate jdbc = newJdbcTemplate();
        SchemaMigrator migrator = new SchemaMigrator(jdbc);
        migrator.afterPropertiesSet();
        migrator.afterPropertiesSet();

        for (String table : List.of("users", "invites", "spaces", "folders", "notes", "note_versions",
                "tags", "note_tags", "links", "attachments", "activities", "settings")) {
            Integer count = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", Integer.class, table);
            assertEquals(1, count, "缺少表 " + table);
        }
        Integer fts = jdbc.queryForObject(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'notes_fts'", Integer.class);
        assertEquals(1, fts, "缺少 FTS5 虚表 notes_fts");
        Integer triggers = jdbc.queryForObject(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'notes_fts_%'",
                Integer.class);
        assertEquals(3, triggers, "缺少 FTS5 触发器");
    }

    @Test
    @DisplayName("PRAGMA：每个连接都带上 WAL / foreign_keys / busy_timeout / synchronous")
    void pragmasAppliedPerConnection() throws SQLException {
        SqliteDataSource dataSource = new SqliteDataSource(
                "jdbc:sqlite:" + tempDir.resolve("pragma.db").toAbsolutePath());
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement()) {
            assertEquals("wal", query(statement, "PRAGMA journal_mode"));
            assertEquals(1, query(statement, "PRAGMA foreign_keys"));
            assertEquals(5000, query(statement, "PRAGMA busy_timeout"));
            assertEquals(1, query(statement, "PRAGMA synchronous")); // NORMAL = 1
        }
        // 第二条连接同样生效（PRAGMA 是连接级设置）
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement()) {
            assertEquals(1, query(statement, "PRAGMA foreign_keys"));
        }
    }

    @Test
    @DisplayName("外键级联：删用户 → 空间 → 笔记 → FTS 行一并消失")
    void foreignKeyCascadeAndFtsTriggersWork() throws Exception {
        JdbcTemplate jdbc = newJdbcTemplate();
        new SchemaMigrator(jdbc).afterPropertiesSet();

        String now = "2026-10-16T02:33:14Z";
        jdbc.update("INSERT INTO users (username, display_name, password_hash, role, created_at)"
                + " VALUES ('alice', '爱丽丝', 'hash', 'admin', ?)", now);
        jdbc.update("INSERT INTO spaces (owner_id, name, created_at)"
                + " SELECT id, '爱丽丝的空间', ? FROM users WHERE username = 'alice'", now);
        jdbc.update("INSERT INTO notes (space_id, title, content, search_blob, created_at, updated_at)"
                + " SELECT id, '今天天气很好', '今天天气很好，适合出去散步', ?, ?, ? FROM spaces",
                SearchText.normalize("今天天气很好 今天天气很好，适合出去散步"), now, now);

        assertTrue(matches(jdbc, "今天"), "触发器写入后应能命中");

        jdbc.update("DELETE FROM users WHERE username = 'alice'");
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM spaces", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM notes", Integer.class));
        assertFalse(matches(jdbc, "今天"), "级联删除后索引行也应随触发器消失");
    }

    /**
     * SCHEMA §4.6 的修复路径。
     *
     * <p>实测结论（external content + fts5）：{@code SELECT COUNT(*) FROM notes_fts}
     * 返回的是<b>内容表</b>的行数，索引被抹掉后它依然是 1，因此不能拿它判断索引是否为空；
     * {@code integrity-check} 也探测不到这种缺失。能否命中的唯一可靠判据是 MATCH 查询本身。
     */
    @Test
    @DisplayName("rebuild 能修复被抹掉的索引；COUNT(*) 不能作为索引是否有内容的判据")
    void rebuildRepairsWipedIndex() throws Exception {
        JdbcTemplate jdbc = newJdbcTemplate();
        new SchemaMigrator(jdbc).afterPropertiesSet();

        String now = "2026-10-16T02:33:14Z";
        jdbc.update("INSERT INTO users (username, display_name, password_hash, role, created_at)"
                + " VALUES ('bob', '鲍勃', 'hash', 'admin', ?)", now);
        jdbc.update("INSERT INTO spaces (owner_id, name, created_at)"
                + " SELECT id, '鲍勃的空间', ? FROM users WHERE username = 'bob'", now);
        jdbc.update("INSERT INTO notes (space_id, title, content, search_blob, created_at, updated_at)"
                + " SELECT id, '笔记', '今天天气很好', ?, ?, ? FROM spaces",
                SearchText.normalize("笔记 今天天气很好"), now, now);

        assertTrue(matches(jdbc, "今天"), "触发器写入后应能命中");

        Long noteId = jdbc.queryForObject("SELECT id FROM notes", Long.class);
        String blob = jdbc.queryForObject("SELECT search_blob FROM notes WHERE id = ?", String.class, noteId);
        jdbc.update("INSERT INTO notes_fts(notes_fts, rowid, search_blob) VALUES('delete', ?, ?)", noteId, blob);

        assertFalse(matches(jdbc, "今天"), "索引行被抹掉后 MATCH 应查不到");
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM notes_fts", Integer.class),
                "COUNT(*) 返回内容表行数，抹掉索引行后仍为 1（陷阱）");

        jdbc.execute("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')");
        assertTrue(matches(jdbc, "今天"), "rebuild 后应恢复命中");
    }

    private static boolean matches(JdbcTemplate jdbc, String query) {
        Integer count = jdbc.queryForObject("""
                SELECT COUNT(*) FROM notes_fts
                JOIN notes n ON n.id = notes_fts.rowid
                WHERE notes_fts MATCH ?
                """, Integer.class, SearchText.toMatchExpression(query));
        return count != null && count > 0;
    }

    private static Object query(Statement statement, String sql) throws SQLException {
        try (ResultSet rs = statement.executeQuery(sql)) {
            rs.next();
            return rs.getObject(1);
        }
    }
}

package com.kb.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 用真实 SQLite + FTS5 验证 SCHEMA §2 的检索策略：归一化后的 blob 能否被
 * {@link SearchText#toMatchExpression} 生成的表达式命中。
 *
 * <p>这是整个搜索功能的地基，因此断言落在「真库真查」上，而不是字符串比对。
 */
class SearchTextFtsTest {

    private static final long SPACE_A = 1L;
    private static final long SPACE_B = 2L;

    private static Connection connection;

    @BeforeAll
    static void setUp() throws SQLException {
        connection = DriverManager.getConnection("jdbc:sqlite::memory:");
        try (Statement st = connection.createStatement()) {
            st.execute("""
                    CREATE TABLE notes (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      space_id INTEGER NOT NULL,
                      title TEXT NOT NULL DEFAULT '',
                      content TEXT NOT NULL DEFAULT '',
                      search_blob TEXT NOT NULL DEFAULT '',
                      deleted_at TEXT
                    )
                    """);
            st.execute("""
                    CREATE VIRTUAL TABLE notes_fts USING fts5(
                      search_blob, content='notes', content_rowid='id',
                      tokenize='unicode61 remove_diacritics 2')
                    """);
            st.execute("""
                    CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes BEGIN
                      INSERT INTO notes_fts(rowid, search_blob) VALUES (new.id, new.search_blob);
                    END
                    """);
            st.execute("""
                    CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes BEGIN
                      INSERT INTO notes_fts(notes_fts, rowid, search_blob) VALUES ('delete', old.id, old.search_blob);
                    END
                    """);
            st.execute("""
                    CREATE TRIGGER notes_fts_au AFTER UPDATE OF search_blob ON notes BEGIN
                      INSERT INTO notes_fts(notes_fts, rowid, search_blob) VALUES ('delete', old.id, old.search_blob);
                      INSERT INTO notes_fts(rowid, search_blob) VALUES (new.id, new.search_blob);
                    END
                    """);
        }
        // 语料：覆盖验收要求里的每个查询词
        insertNote(SPACE_A, "今天天气很好", "今天天气很好，适合出去散步", null);
        insertNote(SPACE_A, "Spring Boot 笔记", "Spring Boot 自动配置与 starter 笔记", null);
        insertNote(SPACE_A, "检索方案", "SQLite FTS5 分词器与 trigram 的比较，知识库检索", null);
        insertNote(SPACE_B, "别人的笔记", "今天天气很好，适合出去散步", null);
        insertNote(SPACE_A, "回收站里的笔记", "今天天气很好，适合出去散步", "2026-01-01T00:00:00Z");
    }

    @AfterAll
    static void tearDown() throws SQLException {
        if (connection != null) {
            connection.close();
        }
    }

    private static void insertNote(long spaceId, String title, String content, String deletedAt) throws SQLException {
        String blob = SearchText.normalize(title + " " + content);
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO notes (space_id, title, content, search_blob, deleted_at) VALUES (?, ?, ?, ?, ?)")) {
            ps.setLong(1, spaceId);
            ps.setString(2, title);
            ps.setString(3, content);
            ps.setString(4, blob);
            ps.setString(5, deletedAt);
            ps.executeUpdate();
        }
    }

    /** SCHEMA §2 的搜索 SQL 骨架。 */
    private static List<Long> search(String query, long spaceId) throws SQLException {
        String expression = SearchText.toMatchExpression(query);
        if (expression.isEmpty()) {
            return List.of();
        }
        String sql = """
                SELECT n.id
                FROM notes_fts
                JOIN notes n ON n.id = notes_fts.rowid
                WHERE notes_fts MATCH ?
                  AND n.space_id = ?
                  AND n.deleted_at IS NULL
                ORDER BY bm25(notes_fts)
                """;
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, expression);
            ps.setLong(2, spaceId);
            try (ResultSet rs = ps.executeQuery()) {
                List<Long> ids = new ArrayList<>();
                while (rs.next()) {
                    ids.add(rs.getLong(1));
                }
                return ids;
            }
        }
    }

    private static void assertHits(String query, List<Long> expected) throws SQLException {
        assertEquals(expected, search(query, SPACE_A), "查询「" + query + "」的命中结果不符");
    }

    @Test
    @DisplayName("中文短语命中「今天天气很好」")
    void chinesePhrases() throws SQLException {
        assertHits("天气", List.of(1L));
        assertHits("今天", List.of(1L));
        assertHits("散步", List.of(1L));
        // 跨词边界：blob 里是「今 天 天 气 很 好」，短语「气 很」要求 token 连续
        assertHits("气很", List.of(1L));
        assertHits("很好", List.of(1L));
        // 单字同样有效（trigram 做不到）
        assertHits("天", List.of(1L));
    }

    @Test
    @DisplayName("拉丁词与大小写：Boot / spring / FTS5")
    void latinTerms() throws SQLException {
        assertHits("Boot", List.of(2L));
        assertHits("boot", List.of(2L));
        assertHits("spring", List.of(2L));
        assertHits("Spring Boot", List.of(2L));
        assertHits("FTS5", List.of(3L));
        assertHits("fts5", List.of(3L));
    }

    @Test
    @DisplayName("笔记 / 分词器 / 知识库 / trigram")
    void requiredVocabulary() throws SQLException {
        assertHits("笔记", List.of(2L));
        assertHits("分词器", List.of(3L));
        assertHits("知识库", List.of(3L));
        assertHits("trigram", List.of(3L));
    }

    @Test
    @DisplayName("不存在的词不命中")
    void unknownTermMisses() throws SQLException {
        assertHits("不存在的词", List.of());
        assertHits("Notion", List.of());
        assertHits("天气xyz", List.of());
    }

    @Test
    @DisplayName("空间隔离与软删除：命中不越界")
    void spaceIsolationAndSoftDelete() throws SQLException {
        assertEquals(List.of(4L), search("天气", SPACE_B));
        // id=5 属于 SPACE_A 但已软删除，不得出现在结果里
        assertTrue(search("天气", SPACE_A).stream().noneMatch(id -> id == 5L));
    }

    @Test
    @DisplayName("FTS5 语法元字符不会抛异常，也不会越权匹配")
    void hostileQueriesDoNotThrow() throws SQLException {
        for (String hostile : List.of(
                "*", "(", ")", "\"", "天气\"", "\"天气", "NEAR", "AND", "OR", "NOT",
                "天气 OR 1=1", "天气\"; DROP TABLE notes;--", "^天气", "weather:blob",
                "天气 AND 笔记", "****", "-天气", "'''", "\\", "天天气气")) {
            String expression = SearchText.toMatchExpression(hostile);
            List<Long> hits = search(hostile, SPACE_A);
            assertTrue(hits.stream().allMatch(id -> id == 1L || id == 2L || id == 3L),
                    "查询「" + hostile + "」表达式「" + expression + "」命中了不该命中的行: " + hits);
        }
        // 表和触发器都还在，索引也仍然可用（COUNT(*) 对 external content 表不可信，用 MATCH 验证）
        assertEquals(5, count("notes"));
        assertHits("天气", List.of(1L));
        assertHits("spring", List.of(2L));
        assertHits("trigram", List.of(3L));
    }

    @Test
    @DisplayName("触发器：更新 search_blob 后新词命中、旧词不再命中；删除后彻底不可命中")
    void updateTriggerKeepsIndexInSync() throws SQLException {
        insertNote(SPACE_A, "临时笔记", "老词 中间态", null);
        long id = maxId();
        assertHits("老词", List.of(id));
        try (PreparedStatement ps = connection.prepareStatement(
                "UPDATE notes SET search_blob = ? WHERE id = ?")) {
            ps.setString(1, SearchText.normalize("临时笔记 新词 中间态"));
            ps.setLong(2, id);
            ps.executeUpdate();
        }
        assertHits("新词", List.of(id));
        assertHits("老词", List.of());
        try (PreparedStatement ps = connection.prepareStatement("DELETE FROM notes WHERE id = ?")) {
            ps.setLong(1, id);
            ps.executeUpdate();
        }
        assertHits("新词", List.of());
        assertEquals(5, count("notes"));
    }

    private static long maxId() throws SQLException {
        try (Statement st = connection.createStatement();
                ResultSet rs = st.executeQuery("SELECT MAX(id) FROM notes")) {
            rs.next();
            return rs.getLong(1);
        }
    }

    private static int count(String table) throws SQLException {
        try (Statement st = connection.createStatement();
                ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM " + table)) {
            rs.next();
            return rs.getInt(1);
        }
    }
}

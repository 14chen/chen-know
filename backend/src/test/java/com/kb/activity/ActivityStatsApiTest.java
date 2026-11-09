package com.kb.activity;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.kb.common.SearchText;
import com.kb.common.Times;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** API.md §4.2 / §9：浏览动态（activities）、最近浏览与统计。 */
@SpringBootTest
@AutoConfigureMockMvc
class ActivityStatsApiTest {

    private static final Path DATA_DIR = createDataDir();

    private static final String ADMIN = "alice";
    private static final String ADMIN_PASSWORD = "adminPass123";
    private static final String MEMBER = "bob";
    private static final String MEMBER_PASSWORD = "memberPass123";

    private static MockHttpSession adminSession;
    private static MockHttpSession memberSession;
    private static long adminSpaceId;
    private static long memberSpaceId;

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    private static Path createDataDir() {
        try {
            return Files.createTempDirectory("kb-activity-");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void ensureAccounts() throws Exception {
        if (adminSession != null) {
            return;
        }
        mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(ADMIN, "爱丽丝", ADMIN_PASSWORD, null).getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isCreated());
        adminSession = login(ADMIN, ADMIN_PASSWORD);
        MvcResult invite = mockMvc.perform(post("/api/admin/invites").session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expiresInHours\":24}".getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isCreated()).andReturn();
        String code = jsonText(invite, "code");
        mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(MEMBER, "鲍勃", MEMBER_PASSWORD, code).getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isCreated());
        memberSession = login(MEMBER, MEMBER_PASSWORD);
        adminSpaceId = spaceIdOf(ADMIN);
        memberSpaceId = spaceIdOf(MEMBER);
    }

    // ---------------------------------------------------------------- 浏览

    @Test
    @DisplayName("POST view → 写 activities；GET /api/recent 去重、按 viewedAt 倒序、字段名固定")
    void viewIsRecordedAndRecentDeduplicates() throws Exception {
        long first = seedNote("最近浏览-A", "内容 A");
        long second = seedNote("最近浏览-B", "内容 B");

        mockMvc.perform(post("/api/notes/" + first + "/view").session(adminSession))
                .andExpect(status().isNoContent());
        mockMvc.perform(post("/api/notes/" + first + "/view").session(adminSession))
                .andExpect(status().isNoContent());
        mockMvc.perform(post("/api/notes/" + second + "/view").session(adminSession))
                .andExpect(status().isNoContent());

        assertEquals(2, count("SELECT COUNT(*) FROM activities WHERE action = 'view' AND note_id = ?", first),
                "每次浏览都应写一条 activity");

        MvcResult result = mockMvc.perform(get("/api/recent").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].noteId").value((int) second))
                .andExpect(jsonPath("$.items[0].title").value("最近浏览-B"))
                .andExpect(jsonPath("$.items[0].viewedAt").isNotEmpty())
                .andExpect(jsonPath("$.items[1].noteId").value((int) first))
                .andExpect(jsonPath("$.items[?(@.noteId == " + first + ")]").value(hasSize(1)))
                .andReturn();
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertTrue(body.contains("\"viewedAt\""), "时间字段名必须是 viewedAt: " + body);
        assertTrue(body.contains("\"folderId\":null"), "未分类笔记的 folderId 字段本体必须在: " + body);
    }

    @Test
    @DisplayName("recent 的边界：limit 生效；已删笔记/他人笔记/不存在的笔记 → 404 且不入列表")
    void recentLimitAndOwnershipChecks() throws Exception {
        long note = seedNote("边界笔记", "内容");
        mockMvc.perform(post("/api/notes/" + note + "/view").session(adminSession)).andExpect(status().isNoContent());
        mockMvc.perform(get("/api/recent").param("limit", "1").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1));

        long deleted = seedNote("已删笔记", "内容");
        jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ?", Times.now(), deleted);
        mockMvc.perform(post("/api/notes/" + deleted + "/view").session(adminSession))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/notes/999999/view").session(adminSession))
                .andExpect(status().isNotFound());

        long bobNote = seedNote(memberSpaceId, "bob 的笔记", "内容");
        mockMvc.perform(post("/api/notes/" + bobNote + "/view").session(adminSession))
                .andExpect(status().isNotFound());
        assertEquals(0, count("SELECT COUNT(*) FROM activities a JOIN users u ON u.id = a.user_id"
                + " WHERE u.username = 'alice' AND a.note_id = ?", bobNote), "越权浏览不得写日志");

        mockMvc.perform(post("/api/notes/" + bobNote + "/view")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/recent")).andExpect(status().isUnauthorized());

        // 浏览后又被删除的笔记，不得出现在 recent 里
        long viewedThenDeleted = seedNote("浏览后删除", "内容");
        mockMvc.perform(post("/api/notes/" + viewedThenDeleted + "/view").session(adminSession))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/recent").session(adminSession))
                .andExpect(jsonPath("$.items[?(@.noteId == " + viewedThenDeleted + ")]").isNotEmpty());
        jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ?", Times.now(), viewedThenDeleted);
        mockMvc.perform(get("/api/recent").session(adminSession))
                .andExpect(jsonPath("$.items[?(@.noteId == " + viewedThenDeleted + ")]").isEmpty());
    }

    // ---------------------------------------------------------------- 统计

    @Test
    @DisplayName("GET /api/stats 各计数与查库行数一致；dailyCreated 恰 14 天（含今天，无数据补 0）")
    void statsMatchDatabaseRows() throws Exception {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        seedNote("今天创建的", "内容");
        seedNoteAt("三天前创建的", "内容", today.minusDays(3));
        seedNoteAt("窗口外的", "内容", today.minusDays(20));
        seedNoteInFolder("目录里的笔记", "内容", seedFolder("统计目录"));
        seedTag("统计标签");
        seedAttachment();
        long deadNote = seedNote("统计回收站笔记", "内容");
        jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ?", Times.now(), deadNote);

        long noteCount = count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL", adminSpaceId);
        long folderCount = count("SELECT COUNT(*) FROM folders WHERE space_id = ? AND deleted_at IS NULL", adminSpaceId);
        long tagCount = count("SELECT COUNT(*) FROM tags WHERE space_id = ?", adminSpaceId);
        long attachmentCount = count("SELECT COUNT(*) FROM attachments WHERE space_id = ?", adminSpaceId);
        long totalBytes = count("SELECT COALESCE(SUM(size_bytes),0) FROM attachments WHERE space_id = ?",
                adminSpaceId);
        long trashCount = count("SELECT (SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NOT NULL)"
                + " + (SELECT COUNT(*) FROM folders WHERE space_id = ? AND deleted_at IS NOT NULL)",
                adminSpaceId, adminSpaceId);
        long updatedToday = count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL"
                + " AND substr(updated_at,1,10) = ?", adminSpaceId, today.toString());
        long createdToday = count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL"
                + " AND substr(created_at,1,10) = ?", adminSpaceId, today.toString());
        long createdThreeDaysAgo = count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL"
                + " AND substr(created_at,1,10) = ?", adminSpaceId, today.minusDays(3).toString());

        MvcResult result = mockMvc.perform(get("/api/stats").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.noteCount").value((int) noteCount))
                .andExpect(jsonPath("$.folderCount").value((int) folderCount))
                .andExpect(jsonPath("$.tagCount").value((int) tagCount))
                .andExpect(jsonPath("$.attachmentCount").value((int) attachmentCount))
                .andExpect(jsonPath("$.totalAttachmentBytes").value((int) totalBytes))
                .andExpect(jsonPath("$.trashCount").value((int) trashCount))
                .andExpect(jsonPath("$.updatedToday").value((int) updatedToday))
                .andExpect(jsonPath("$.dailyCreated.length()").value(14))
                .andReturn();

        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertEquals(today.minusDays(13).toString(), firstDailyDate(body), "窗口起点必须是 13 天前");
        assertEquals(today.toString(), lastDailyDate(body), "窗口终点必须是今天");
        assertEquals(createdToday, count(body, "\"" + today + "\""));
        assertEquals(createdThreeDaysAgo, count(body, "\"" + today.minusDays(3) + "\""));
        assertTrue(body.contains("\"" + today.minusDays(13) + "\""), "无数据的日期必须补 0 出现: " + body);

        // 日期连续
        Matcher matcher = Pattern.compile("\"date\":\"(\\d{4}-\\d{2}-\\d{2})\"").matcher(body);
        LocalDate previous = null;
        int seen = 0;
        while (matcher.find()) {
            LocalDate date = LocalDate.parse(matcher.group(1));
            if (previous != null) {
                assertEquals(1, ChronoUnit.DAYS.between(previous, date), "日期必须连续: " + previous + " -> " + date);
            }
            previous = date;
            seen++;
        }
        assertEquals(14, seen);
    }

    @Test
    @DisplayName("统计与最近浏览按空间隔离：bob 看不到 alice 的任何数据")
    void statsAreSpaceScoped() throws Exception {
        long aliceNote = seedNote("alice 的笔记", "内容");
        mockMvc.perform(post("/api/notes/" + aliceNote + "/view").session(adminSession))
                .andExpect(status().isNoContent());

        long bobNotes = count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL", memberSpaceId);
        long bobAttachments = count("SELECT COUNT(*) FROM attachments WHERE space_id = ?", memberSpaceId);
        long aliceNotes = count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL", adminSpaceId);
        assertTrue(aliceNotes > bobNotes, "alice 的笔记数应多于 bob（用于证明统计未串空间）");

        mockMvc.perform(get("/api/stats").session(memberSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.noteCount").value((int) bobNotes))
                .andExpect(jsonPath("$.attachmentCount").value((int) bobAttachments))
                .andExpect(jsonPath("$.dailyCreated.length()").value(14));
        mockMvc.perform(get("/api/recent").session(memberSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.noteId == " + aliceNote + ")]").isEmpty());
        assertTrue(memberSpaceId != adminSpaceId);
    }

    // ---------------------------------------------------------------- 工具

    private static String lastDailyDate(String body) {
        Matcher matcher = Pattern.compile("\"date\":\"(\\d{4}-\\d{2}-\\d{2})\"").matcher(body);
        String last = null;
        while (matcher.find()) {
            last = matcher.group(1);
        }
        return last;
    }

    private static String firstDailyDate(String body) {
        Matcher matcher = Pattern.compile("\"date\":\"(\\d{4}-\\d{2}-\\d{2})\"").matcher(body);
        return matcher.find() ? matcher.group(1) : null;
    }

    /** 取 body 里 {@code "date":"<day>","count":N} 的 N。 */
    private static long count(String body, String quotedDate) {
        Matcher matcher = Pattern.compile(Pattern.quote(quotedDate) + ",\"count\":(\\d+)").matcher(body);
        assertTrue(matcher.find(), "找不到 " + quotedDate + " 的统计: " + body);
        return Long.parseLong(matcher.group(1));
    }

    private long seedNote(String title, String content) {
        return seedNote(adminSpaceId, title, content, LocalDate.now(ZoneOffset.UTC));
    }

    private long seedNoteAt(String title, String content, LocalDate day) {
        return seedNote(adminSpaceId, title, content, day);
    }

    private long seedNoteInFolder(String title, String content, long folderId) {
        long noteId = seedNote(adminSpaceId, title, content, LocalDate.now(ZoneOffset.UTC));
        jdbc.update("UPDATE notes SET folder_id = ? WHERE id = ?", folderId, noteId);
        return noteId;
    }

    private long seedNote(long spaceId, String title, String content) {
        return seedNote(spaceId, title, content, LocalDate.now(ZoneOffset.UTC));
    }

    private long seedNote(long spaceId, String title, String content, LocalDate day) {
        String createdAt = Times.format(day.atStartOfDay(ZoneOffset.UTC).toInstant().plus(1, ChronoUnit.HOURS));
        jdbc.update("INSERT INTO notes (space_id, title, content, excerpt, search_blob, created_at, updated_at)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?)",
                spaceId, title, content, content, SearchText.normalize(title + "\n" + content), createdAt, createdAt);
        assertNotNull(Instant.parse(createdAt));
        return jdbc.queryForObject("SELECT id FROM notes WHERE space_id = ? AND title = ? ORDER BY id DESC LIMIT 1",
                Long.class, spaceId, title);
    }

    private long seedFolder(String name) {
        String now = Times.now();
        jdbc.update("INSERT INTO folders (space_id, parent_id, name, sort_order, created_at, updated_at)"
                + " VALUES (?, NULL, ?, 0, ?, ?)", adminSpaceId, name, now, now);
        return jdbc.queryForObject("SELECT id FROM folders WHERE space_id = ? AND name = ? ORDER BY id DESC LIMIT 1",
                Long.class, adminSpaceId, name);
    }

    private void seedTag(String name) {
        jdbc.update("INSERT INTO tags (space_id, name, color) VALUES (?, ?, '#6b7280')", adminSpaceId, name);
    }

    private void seedAttachment() {
        jdbc.update("INSERT INTO attachments (space_id, note_id, stored_name, original_name, mime_type, size_bytes,"
                        + " sha256, created_at) VALUES (?, NULL, ?, 'a.png', 'image/png', 2048, 'deadbeef', ?)",
                adminSpaceId, adminSpaceId + "/seed.png", Times.now());
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0 : value;
    }

    private static String registerBody(String username, String displayName, String password, String inviteCode) {
        return "{\"username\":\"%s\",\"displayName\":\"%s\",\"password\":\"%s\",\"inviteCode\":%s}"
                .formatted(username, displayName, password,
                        inviteCode == null ? "null" : "\"" + inviteCode + "\"");
    }

    private MockHttpSession login(String username, String password) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"%s\",\"password\":\"%s\"}".formatted(username, password)
                                .getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);
        assertNotNull(session);
        return session;
    }

    private long spaceIdOf(String username) {
        return jdbc.queryForObject(
                "SELECT id FROM spaces WHERE owner_id = (SELECT id FROM users WHERE username = ?)",
                Long.class, username);
    }

    private static String jsonText(MvcResult result, String key) throws Exception {
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        Matcher matcher = Pattern.compile("\"" + key + "\":\"([^\"]*)\"").matcher(body);
        assertTrue(matcher.find(), "响应里找不到字段 " + key + ": " + body);
        return matcher.group(1);
    }
}

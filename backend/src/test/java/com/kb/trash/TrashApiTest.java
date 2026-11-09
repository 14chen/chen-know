package com.kb.trash;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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

/** API.md §8 回收站：软删除可见性、恢复语义（同一次删除的时间戳）、彻底删除的 SQL 级联。 */
@SpringBootTest
@AutoConfigureMockMvc
class TrashApiTest {

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
            return Files.createTempDirectory("kb-trash-");
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

    // ---------------------------------------------------------------- 软删除可见性

    @Test
    @DisplayName("软删笔记 → 进回收站；列表与 MATCH 搜索都查不到")
    void softDeletedNoteLeavesSearchButStaysInTrash() throws Exception {
        long noteId = seedNote(null, "暴雨笔记", "今天暴雨很大，注意带伞");
        String deletedAt = Times.now();
        jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ?", deletedAt, noteId);

        mockMvc.perform(get("/api/trash").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notes[?(@.id == " + noteId + ")]").isNotEmpty())
                .andExpect(jsonPath("$.notes[0].deletedAt").isNotEmpty());
        assertEquals(0, matchCount("暴雨"), "软删的笔记不得被 MATCH 命中");
    }

    @Test
    @DisplayName("恢复笔记 → 回来，且 MATCH 搜索重新命中（实测 FTS）")
    void restoredNoteIsSearchableAgain() throws Exception {
        long noteId = seedNote(null, "晴朗笔记", "今天晴朗无云");
        jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ?", Times.now(), noteId);
        assertEquals(0, matchCount("晴朗"), "删除期间不得命中");

        mockMvc.perform(post("/api/trash/notes/" + noteId + "/restore").session(adminSession))
                .andExpect(status().isNoContent());
        assertEquals(1, count("SELECT COUNT(*) FROM notes WHERE id = ? AND deleted_at IS NULL", noteId),
                "恢复后 deleted_at 必须为 NULL");
        assertEquals(1, matchCount("晴朗"), "恢复后 MATCH 必须重新命中");
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM activities WHERE action = 'restore' AND note_id = ?",
                Integer.class, noteId));
    }

    // ---------------------------------------------------------------- 目录级联

    @Test
    @DisplayName("删目录 → 子孙目录与其中笔记全部进回收站；恢复目录 → 一并回来")
    void folderDeleteAndRestoreCascades() throws Exception {
        long rootFolder = seedFolder(null, "技术");
        long childFolder = seedFolder(rootFolder, "Java");
        long noteInChild = seedNote(childFolder, "子目录笔记", "Spring 自动配置");
        long noteInRoot = seedNote(rootFolder, "根目录笔记", "目录树语义");
        long untouched = seedNote(null, "无关笔记", "不应受影响");
        long emptyFolder = seedFolder(rootFolder, "空目录");

        String deletedAt = Times.now();
        softDeleteFolderTree(rootFolder, adminSpaceId, deletedAt);

        mockMvc.perform(get("/api/trash").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.folders[?(@.id == " + rootFolder + ")]").isNotEmpty())
                .andExpect(jsonPath("$.folders[?(@.id == " + childFolder + ")]").isNotEmpty())
                .andExpect(jsonPath("$.folders[?(@.id == " + emptyFolder + ")]").isNotEmpty())
                .andExpect(jsonPath("$.notes[?(@.id == " + noteInChild + ")]").isNotEmpty())
                .andExpect(jsonPath("$.notes[?(@.id == " + noteInRoot + ")]").isNotEmpty())
                .andExpect(jsonPath("$.notes[?(@.id == " + untouched + ")]").isEmpty());

        mockMvc.perform(post("/api/trash/folders/" + rootFolder + "/restore").session(adminSession))
                .andExpect(status().isNoContent());

        for (long folderId : new long[] {rootFolder, childFolder, emptyFolder}) {
            assertEquals(1, count("SELECT COUNT(*) FROM folders WHERE id = ? AND deleted_at IS NULL", folderId),
                    "目录 " + folderId + " 应已恢复");
        }
        for (long noteId : new long[] {noteInChild, noteInRoot}) {
            assertEquals(1, count("SELECT COUNT(*) FROM notes WHERE id = ? AND deleted_at IS NULL", noteId),
                    "笔记 " + noteId + " 应随目录恢复");
        }
        assertEquals(1, count("SELECT COUNT(*) FROM notes WHERE id = ? AND deleted_at IS NULL", untouched));
        mockMvc.perform(get("/api/trash").session(adminSession))
                .andExpect(jsonPath("$.folders[?(@.id == " + rootFolder + ")]").isEmpty());
    }

    @Test
    @DisplayName("只恢复与目录同一次删除（相同 deleted_at）的笔记，单独删过的不动")
    void restoreOnlyBringsBackNotesDeletedWithTheFolder() throws Exception {
        long folder = seedFolder(null, "混合目录");
        long noteDeletedEarlier = seedNote(folder, "先删的笔记", "单独删除");
        long noteDeletedTogether = seedNote(folder, "一起删的笔记", "随目录删除");

        String earlierDeletion = Times.now();
        jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ?", earlierDeletion, noteDeletedEarlier);
        // 两次删除必须落在不同毫秒：回收站按 deleted_at 相等判定"同一次删除"，同毫秒会把两者当成同批
        softDeleteFolderTree(folder, adminSpaceId, timestampAfter(earlierDeletion));

        mockMvc.perform(post("/api/trash/folders/" + folder + "/restore").session(adminSession))
                .andExpect(status().isNoContent());
        assertEquals(1, count("SELECT COUNT(*) FROM notes WHERE id = ? AND deleted_at IS NULL",
                noteDeletedTogether), "随目录一起删的笔记应恢复");
        assertEquals(0, count("SELECT COUNT(*) FROM notes WHERE id = ? AND deleted_at IS NULL",
                noteDeletedEarlier), "更早单独删的笔记不得恢复");
    }

    @Test
    @DisplayName("单独恢复子目录：祖先链一起恢复，避免出现挂在不存在的父目录下")
    void restoreChildFolderRestoresAncestorChain() throws Exception {
        long parent = seedFolder(null, "父目录");
        long child = seedFolder(parent, "子目录");
        long note = seedNote(child, "子目录笔记", "内容");
        softDeleteFolderTree(parent, adminSpaceId, Times.now());

        mockMvc.perform(post("/api/trash/folders/" + child + "/restore").session(adminSession))
                .andExpect(status().isNoContent());
        assertEquals(1, count("SELECT COUNT(*) FROM folders WHERE id = ? AND deleted_at IS NULL", parent));
        assertEquals(1, count("SELECT COUNT(*) FROM folders WHERE id = ? AND deleted_at IS NULL", child));
        assertEquals(1, count("SELECT COUNT(*) FROM notes WHERE id = ? AND deleted_at IS NULL", note),
                "父目录的删除与子目录同时间戳，故子目录里的笔记也一起恢复");
        assertEquals("父目录", jdbc.queryForObject("SELECT name FROM folders WHERE id = ?", String.class, parent));
    }

    @Test
    @DisplayName("§8.1 结构：notes[].folderName 字段必存在（未分类为 null）；folders[].noteCount 含子孙目录")
    void trashPayloadShapeMatchesContract() throws Exception {
        long parent = seedFolder(null, "技术");
        long child = seedFolder(parent, "Java");
        long noteInChild = seedNote(child, "契约笔记", "内容");
        long unclassifiedNote = seedNote(null, "未分类笔记", "内容");
        String deletedAt = Times.now();
        jdbc.update("UPDATE notes SET deleted_at = ? WHERE id IN (?, ?)", deletedAt, noteInChild, unclassifiedNote);
        softDeleteFolderTree(parent, adminSpaceId, deletedAt);

        String body = mockMvc.perform(get("/api/trash").session(adminSession))
                .andExpect(status().isOk())
                // 父目录没有直属笔记，noteCount=1 只能来自子孙目录里的同批软删笔记
                .andExpect(jsonPath("$.folders[?(@.id == " + parent + ")].noteCount").value(hasItem(1)))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertTrue(body.contains("\"folderName\":\"Java\""), "notes[].folderName 必须是目录名: " + body);
        assertTrue(body.contains("\"folderName\":null"), "未分类笔记的 folderName 字段本体必须在: " + body);
    }

    // ---------------------------------------------------------------- 彻底删除

    @Test
    @DisplayName("彻底删笔记：notes/note_versions/note_tags/links 全清，FTS 行也消失")
    void purgeNoteCascadesEverywhere() throws Exception {
        long noteId = seedNote(null, "待彻底删除", "今天天气很好");
        long tagId = seedTag("待删标签");
        jdbc.update("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)", noteId, tagId);
        jdbc.update("INSERT INTO note_versions (note_id, version, title, content, created_at)"
                + " VALUES (?, 1, '旧标题', '旧正文', ?)", noteId, Times.now());
        jdbc.update("INSERT INTO links (space_id, source_note_id, target_title, created_at) VALUES (?, ?, ?, ?)",
                adminSpaceId, noteId, "某目标", Times.now());
        jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ?", Times.now(), noteId);

        mockMvc.perform(delete("/api/trash/notes/" + noteId).session(adminSession))
                .andExpect(status().isNoContent());

        assertEquals(0, count("SELECT COUNT(*) FROM notes WHERE id = ?", noteId));
        assertEquals(0, count("SELECT COUNT(*) FROM note_versions WHERE note_id = ?", noteId));
        assertEquals(0, count("SELECT COUNT(*) FROM note_tags WHERE note_id = ?", noteId));
        assertEquals(0, count("SELECT COUNT(*) FROM links WHERE source_note_id = ?", noteId));
        assertEquals(0, count("SELECT COUNT(*) FROM notes_fts WHERE rowid = ?", noteId), "FTS 行应由触发器清掉");
        mockMvc.perform(delete("/api/trash/notes/" + noteId).session(adminSession))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("彻底删目录：子树目录与其中的笔记行都没了")
    void purgeFolderRemovesSubtree() throws Exception {
        long root = seedFolder(null, "待删根");
        long child = seedFolder(root, "待删子");
        long note = seedNote(child, "待删笔记", "正文");
        softDeleteFolderTree(root, adminSpaceId, Times.now());

        mockMvc.perform(delete("/api/trash/folders/" + root).session(adminSession))
                .andExpect(status().isNoContent());
        assertEquals(0, count("SELECT COUNT(*) FROM folders WHERE id IN (?, ?)", root, child));
        assertEquals(0, count("SELECT COUNT(*) FROM notes WHERE id = ?", note));
        mockMvc.perform(delete("/api/trash/folders/" + root).session(adminSession))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("活着的笔记不能被回收站接口彻底删除（404，数据保留）")
    void purgeRefusesAliveNote() throws Exception {
        long noteId = seedNote(null, "活着的笔记", "正文");
        mockMvc.perform(delete("/api/trash/notes/" + noteId).session(adminSession))
                .andExpect(status().isNotFound());
        assertEquals(1, count("SELECT COUNT(*) FROM notes WHERE id = ?", noteId));
    }

    @Test
    @DisplayName("清空回收站：返回正确计数，回收站变空")
    void emptyTrashReturnsCounts() throws Exception {
        long deadNote1 = seedNote(null, "清空-1", "x");
        long deadNote2 = seedNote(null, "清空-2", "x");
        String deletedAt = Times.now();
        jdbc.update("UPDATE notes SET deleted_at = ? WHERE id IN (?, ?)", deletedAt, deadNote1, deadNote2);
        long deadFolder = seedFolder(null, "清空目录");
        softDeleteFolderTree(deadFolder, adminSpaceId, deletedAt);

        long expectedNotes = count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NOT NULL",
                adminSpaceId);
        long expectedFolders = count("SELECT COUNT(*) FROM folders WHERE space_id = ? AND deleted_at IS NOT NULL",
                adminSpaceId);

        mockMvc.perform(post("/api/trash/empty").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deletedNotes").value(expectedNotes))
                .andExpect(jsonPath("$.deletedFolders").value(expectedFolders));

        mockMvc.perform(get("/api/trash").session(adminSession))
                .andExpect(jsonPath("$.notes").isEmpty())
                .andExpect(jsonPath("$.folders").isEmpty());
    }

    // ---------------------------------------------------------------- 跨空间

    @Test
    @DisplayName("跨空间：bob 看不到 alice 的回收站，也不能恢复/彻底删除")
    void crossSpaceIsolation() throws Exception {
        long aliceNote = seedNote(null, "alice 的私密笔记", "内容");
        jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ?", Times.now(), aliceNote);
        long bobNote = seedNote(memberSpaceId, null, "bob 的笔记", "内容");
        jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ?", Times.now(), bobNote);

        mockMvc.perform(get("/api/trash").session(memberSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notes[?(@.id == " + aliceNote + ")]").isEmpty())
                .andExpect(jsonPath("$.notes[?(@.id == " + bobNote + ")]").isNotEmpty());

        mockMvc.perform(post("/api/trash/notes/" + aliceNote + "/restore").session(memberSession))
                .andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/trash/notes/" + aliceNote).session(memberSession))
                .andExpect(status().isNotFound());
        assertEquals(0, count("SELECT COUNT(*) FROM notes WHERE id = ? AND deleted_at IS NULL", aliceNote));

        mockMvc.perform(get("/api/trash")).andExpect(status().isUnauthorized());
    }

    // ---------------------------------------------------------------- 工具

    private long seedNote(Long folderId, String title, String content) {
        return seedNote(adminSpaceId, folderId, title, content);
    }

    private long seedNote(long spaceId, Long folderId, String title, String content) {
        String now = Times.now();
        jdbc.update("INSERT INTO notes (space_id, folder_id, title, content, excerpt, search_blob,"
                        + " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                spaceId, folderId, title, content, content, SearchText.normalize(title + "\n" + content), now, now);
        return jdbc.queryForObject("SELECT id FROM notes WHERE space_id = ? AND title = ? ORDER BY id DESC LIMIT 1",
                Long.class, spaceId, title);
    }

    private long seedFolder(Long parentId, String name) {
        String now = Times.now();
        jdbc.update("INSERT INTO folders (space_id, parent_id, name, sort_order, created_at, updated_at)"
                + " VALUES (?, ?, ?, 0, ?, ?)", adminSpaceId, parentId, name, now, now);
        return jdbc.queryForObject("SELECT id FROM folders WHERE space_id = ? AND name = ? ORDER BY id DESC LIMIT 1",
                Long.class, adminSpaceId, name);
    }

    private long seedTag(String name) {
        jdbc.update("INSERT INTO tags (space_id, name, color) VALUES (?, ?, '#6b7280')", adminSpaceId, name);
        return jdbc.queryForObject("SELECT id FROM tags WHERE space_id = ? AND name = ?", Long.class,
                adminSpaceId, name);
    }

    /** 取一个严格晚于 {@code timestamp} 的时间戳（ISO-8601 UTC 毫秒精度），避免两次删除撞进同一毫秒。 */
    private static String timestampAfter(String timestamp) throws InterruptedException {
        Instant threshold = Instant.parse(timestamp);
        String candidate = Times.now();
        for (int i = 0; i < 2000 && !Instant.parse(candidate).isAfter(threshold); i++) {
            Thread.sleep(1);
            candidate = Times.now();
        }
        assertTrue(Instant.parse(candidate).isAfter(threshold), "时钟未推进，无法构造两次不同的删除时间戳");
        return candidate;
    }

    /** 复刻 SCHEMA §3 的目录软删：子树目录与其中笔记写入**同一个** deleted_at。 */
    private void softDeleteFolderTree(long folderId, long spaceId, String deletedAt) {
        jdbc.update("""
                WITH RECURSIVE sub(id) AS (
                  SELECT id FROM folders WHERE id = ? AND space_id = ?
                  UNION ALL
                  SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
                )
                UPDATE folders SET deleted_at = ? WHERE id IN (SELECT id FROM sub)
                """, folderId, spaceId, deletedAt);
        jdbc.update("""
                WITH RECURSIVE sub(id) AS (
                  SELECT id FROM folders WHERE id = ? AND space_id = ?
                  UNION ALL
                  SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
                )
                UPDATE notes SET deleted_at = ? WHERE space_id = ? AND deleted_at IS NULL
                  AND folder_id IN (SELECT id FROM sub)
                """, folderId, spaceId, deletedAt, spaceId);
    }

    /** 与搜索模块一致的判定：JOIN 回 notes 过滤空间与软删除，只看 MATCH。 */
    private long matchCount(String query) {
        String expression = SearchText.toMatchExpression(query);
        Long count = jdbc.queryForObject("""
                SELECT COUNT(*) FROM notes_fts
                JOIN notes n ON n.id = notes_fts.rowid
                WHERE notes_fts MATCH ? AND n.space_id = ? AND n.deleted_at IS NULL
                """, Long.class, expression, adminSpaceId);
        return count == null ? 0 : count;
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

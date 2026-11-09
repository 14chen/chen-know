package com.kb.attachment;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.kb.common.Times;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

/** API.md §7 附件：六条安全要求逐条实测。 */
@SpringBootTest
@AutoConfigureMockMvc
class AttachmentApiTest {

    private static final Path DATA_DIR = createDataDir();
    private static final Path UPLOADS_DIR = DATA_DIR.resolve("uploads");

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
            return Files.createTempDirectory("kb-attachment-");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

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
                .andExpect(status().isCreated())
                .andReturn();
        String code = jsonText(invite, "code");
        mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(MEMBER, "鲍勃", MEMBER_PASSWORD, code).getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isCreated());
        memberSession = login(MEMBER, MEMBER_PASSWORD);
        adminSpaceId = spaceIdOf(ADMIN);
        memberSpaceId = spaceIdOf(MEMBER);
    }

    // ---------------------------------------------------------------- 用例 1/2

    @Test
    @DisplayName("① 上传 PNG → 201；GET 回来字节完全一致（sha256），响应头带 nosniff")
    void uploadPngRoundTripsIdenticalBytes() throws Exception {
        byte[] png = pngBytes();
        MvcResult uploaded = upload(adminSession, "架构图.png", "image/png", png)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.originalName").value("架构图.png"))
                .andExpect(jsonPath("$.mimeType").value("image/png"))
                .andExpect(jsonPath("$.sizeBytes").value(png.length))
                .andExpect(jsonPath("$.url").isNotEmpty())
                .andReturn();
        long id = jsonLong(uploaded, "id");

        byte[] fetched = mockMvc.perform(get("/api/attachments/" + id).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string(HttpHeaders.CONTENT_TYPE, "image/png"))
                .andReturn().getResponse().getContentAsByteArray();

        assertEquals(sha256(png), sha256(fetched), "取回的字节必须与原文件一致");
        Map<String, Object> row = jdbcTemplate.queryForMap("SELECT * FROM attachments WHERE id = ?", id);
        assertEquals(sha256(png), row.get("sha256"), "库里存的必须是真实计算的 sha256");
        assertEquals((long) png.length, ((Number) row.get("size_bytes")).longValue());
        assertEquals(adminSpaceId, ((Number) row.get("space_id")).longValue());
        assertEquals("image/png", row.get("mime_type"));
    }

    @Test
    @DisplayName("② 超过 20 MB → 413；非白名单类型 → 415")
    void sizeAndTypeLimits() throws Exception {
        long filesBefore = countUploadedFiles(adminSpaceId);
        byte[] tooBig = new byte[21 * 1024 * 1024];
        MockMultipartFile bigFile = new MockMultipartFile("file", "big.png", "image/png", tooBig);
        mockMvc.perform(multipart("/api/attachments").file(bigFile).session(adminSession))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.error.code").value("PAYLOAD_TOO_LARGE"));

        upload(adminSession, "virus.exe", "application/octet-stream", "MZ".getBytes(StandardCharsets.UTF_8))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error.code").value("UNSUPPORTED_MEDIA_TYPE"));
        upload(adminSession, "page.html", "text/html", "<script>x</script>".getBytes(StandardCharsets.UTF_8))
                .andExpect(status().isUnsupportedMediaType());

        assertEquals(filesBefore, countUploadedFiles(adminSpaceId), "被拒绝的上传不得在磁盘留下文件");
    }

    @Test
    @DisplayName("③ 客户端文件名 ../../evil.png 不参与路径：文件落在 uploads/{spaceId}/ 内")
    void clientFileNameCannotEscapeUploadsDir() throws Exception {
        MvcResult uploaded = upload(adminSession, "../../evil.png", "image/png", pngBytes())
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.originalName").value("evil.png"))
                .andReturn();
        long id = jsonLong(uploaded, "id");

        String storedName = (String) jdbcTemplate.queryForMap(
                "SELECT stored_name FROM attachments WHERE id = ?", id).get("stored_name");
        assertTrue(storedName.matches(adminSpaceId + "/[0-9a-f-]{36}\\.png"),
                "落盘名必须是 {spaceId}/{UUID}.png，实际: " + storedName);
        assertFalse(storedName.contains(".."), "落盘名不得含越界片段");

        List<Path> files = listFiles(UPLOADS_DIR);
        assertFalse(files.isEmpty(), "应当有落盘文件");
        for (Path file : files) {
            Path spaceDir = file.getParent();
            assertNotNull(spaceDir.getParent());
            assertTrue(spaceDir.getParent().equals(UPLOADS_DIR) && spaceDir.getFileName().toString().matches("\\d+"),
                    "附件必须落在 uploads/{spaceId}/ 下，越界: " + file);
        }
        assertTrue(files.stream().anyMatch(file -> file.startsWith(UPLOADS_DIR.resolve(String.valueOf(adminSpaceId)))),
                "本次上传应落在 uploads/{aliceSpace}/ 内");
        assertFalse(Files.exists(UPLOADS_DIR.resolve("../../evil.png").normalize()), "uploads/../../evil.png 不得存在");
        assertFalse(Files.exists(UPLOADS_DIR.resolve("../evil.png").normalize()), "uploads/../evil.png 不得存在");
    }

    // ---------------------------------------------------------------- 用例 3/4

    @Test
    @DisplayName("④ SVG 强制 Content-Disposition: attachment（防内嵌脚本 XSS）")
    void svgIsForcedToAttachment() throws Exception {
        byte[] svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"
                .getBytes(StandardCharsets.UTF_8);
        MvcResult uploaded = upload(adminSession, "x.svg", "image/svg+xml", svg)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.mimeType").value("image/svg+xml"))
                .andReturn();
        long id = jsonLong(uploaded, "id");

        MvcResult fetched = mockMvc.perform(get("/api/attachments/" + id).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string("X-Content-Type-Options", "nosniff"))
                .andReturn();
        String disposition = fetched.getResponse().getHeader(HttpHeaders.CONTENT_DISPOSITION);
        assertNotNull(disposition);
        assertTrue(disposition.startsWith("attachment;"), "SVG 必须强制下载，实际: " + disposition);

        // 对照：PNG 用 inline
        MvcResult png = upload(adminSession, "inline.png", "image/png", pngBytes())
                .andExpect(status().isCreated()).andReturn();
        String pngDisposition = mockMvc.perform(get("/api/attachments/" + jsonLong(png, "id")).session(adminSession))
                .andReturn().getResponse().getHeader(HttpHeaders.CONTENT_DISPOSITION);
        assertTrue(pngDisposition.startsWith("inline;"), "PNG 应为 inline，实际: " + pngDisposition);
        assertTrue(pngDisposition.contains("filename*=UTF-8''"), "文件名必须用 RFC 5987 编码");
    }

    @Test
    @DisplayName("④b 中文文件名用 RFC 5987 编码，不乱码")
    void chineseFileNameIsRfc5987Encoded() throws Exception {
        MvcResult uploaded = upload(adminSession, "中文 名图片.png", "image/png", pngBytes())
                .andExpect(status().isCreated()).andReturn();
        String disposition = mockMvc.perform(get("/api/attachments/" + jsonLong(uploaded, "id")).session(adminSession))
                .andReturn().getResponse().getHeader(HttpHeaders.CONTENT_DISPOSITION);
        assertTrue(disposition.contains("filename*=UTF-8''"), disposition);
        assertTrue(disposition.contains("%E4%B8%AD%E6%96%87"), "中文应按 UTF-8 百分号编码: " + disposition);
    }

    // ---------------------------------------------------------------- 用例 5/6

    @Test
    @DisplayName("⑥ 跨空间：bob 读/删 alice 的附件一律 404，且不返回字节")
    void crossSpaceAccessIsNotFound() throws Exception {
        byte[] png = pngBytes();
        long aliceAttachment = jsonLong(upload(adminSession, "secret.png", "image/png", png)
                .andExpect(status().isCreated()).andReturn(), "id");

        MvcResult denied = mockMvc.perform(get("/api/attachments/" + aliceAttachment).session(memberSession))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"))
                .andReturn();
        assertFalse(new String(denied.getResponse().getContentAsByteArray(), StandardCharsets.ISO_8859_1)
                .contains(new String(png, StandardCharsets.ISO_8859_1)), "不得返回他人附件字节");

        mockMvc.perform(delete("/api/attachments/" + aliceAttachment).session(memberSession))
                .andExpect(status().isNotFound());
        assertEquals(1, jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM attachments WHERE id = ?", Integer.class, aliceAttachment),
                "bob 的越权删除不得生效");

        mockMvc.perform(get("/api/attachments/" + aliceAttachment)).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("DELETE 同时删记录与磁盘文件；重复删除 404")
    void deleteRemovesRowAndFile() throws Exception {
        long id = jsonLong(upload(adminSession, "del.png", "image/png", pngBytes())
                .andExpect(status().isCreated()).andReturn(), "id");
        String storedName = (String) jdbcTemplate.queryForMap(
                "SELECT stored_name FROM attachments WHERE id = ?", id).get("stored_name");
        Path file = UPLOADS_DIR.resolve(storedName);
        assertTrue(Files.isRegularFile(file), "删除前应存在: " + file);

        mockMvc.perform(delete("/api/attachments/" + id).session(adminSession))
                .andExpect(status().isNoContent());
        assertFalse(Files.exists(file), "磁盘文件必须一起删除");
        assertEquals(0, jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM attachments WHERE id = ?", Integer.class, id));
        mockMvc.perform(delete("/api/attachments/" + id).session(adminSession))
                .andExpect(status().isNotFound());
    }

    // ---------------------------------------------------------------- 边界

    @Test
    @DisplayName("缺少 file 部件 → 400；noteId 必须是本空间未删除笔记")
    void bindsNoteAndValidatesOwnership() throws Exception {
        mockMvc.perform(multipart("/api/attachments").session(adminSession))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("file"));

        String now = Times.now();
        jdbcTemplate.update("INSERT INTO notes (space_id, title, content, search_blob, created_at, updated_at)"
                + " VALUES (?, ?, ?, '', ?, ?)", adminSpaceId, "附件宿主", "正文", now, now);
        long noteId = jdbcTemplate.queryForObject(
                "SELECT id FROM notes WHERE space_id = ? AND title = '附件宿主'", Long.class, adminSpaceId);

        MvcResult bound = mockMvc.perform(multipart("/api/attachments")
                        .file(new MockMultipartFile("file", "bound.png", "image/png", pngBytes()))
                        .param("noteId", String.valueOf(noteId))
                        .session(adminSession))
                .andExpect(status().isCreated())
                .andReturn();
        assertEquals(noteId, ((Number) jdbcTemplate.queryForMap("SELECT note_id FROM attachments WHERE id = ?",
                jsonLong(bound, "id")).get("note_id")).longValue());

        mockMvc.perform(multipart("/api/attachments")
                        .file(new MockMultipartFile("file", "x.png", "image/png", pngBytes()))
                        .param("noteId", String.valueOf(noteId)).session(memberSession))
                .andExpect(status().isNotFound());
        mockMvc.perform(multipart("/api/attachments")
                        .file(new MockMultipartFile("file", "x.png", "image/png", pngBytes()))
                        .param("noteId", "999999").session(adminSession))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("附件目录按空间隔离：alice 与 bob 各自 uploads/{spaceId}/")
    void uploadsAreIsolatedPerSpace() throws Exception {
        long bobAttachment = jsonLong(upload(memberSession, "bob.png", "image/png", pngBytes())
                .andExpect(status().isCreated()).andReturn(), "id");
        assertEquals(memberSpaceId, ((Number) jdbcTemplate.queryForMap(
                "SELECT space_id FROM attachments WHERE id = ?", bobAttachment).get("space_id")).longValue());
        mockMvc.perform(get("/api/attachments/" + bobAttachment).session(adminSession))
                .andExpect(status().isNotFound());
    }

    // ---------------------------------------------------------------- 工具

    @Test
    @DisplayName("体检：表里有记录但磁盘文件缺失 → missing/missingItems 内容正确（不猜、不抛）")
    void healthReportsMissingFiles() throws Exception {
        MvcResult firstHealth = mockMvc.perform(get("/api/attachments/health").session(adminSession))
                .andExpect(status().isOk()).andReturn();
        long totalBefore = jsonLong(firstHealth, "total");
        long missingBefore = jsonLong(firstHealth, "missing");

        MvcResult uploaded = upload(adminSession, "会丢失的图.png", "image/png", pngBytes())
                .andExpect(status().isCreated()).andReturn();
        long id = jsonLong(uploaded, "id");
        long noteId = createNoteForAttachment("断链笔记", "图片会丢");

        // 关联到笔记，便于报告里带 noteTitle
        jdbcTemplate.update("UPDATE attachments SET note_id = ? WHERE id = ?", noteId, id);
        String storedName = (String) jdbcTemplate.queryForMap(
                "SELECT stored_name FROM attachments WHERE id = ?", id).get("stored_name");
        Path file = UPLOADS_DIR.resolve(storedName);
        assertTrue(Files.isRegularFile(file), "上传后文件应存在");
        Files.delete(file);                                 // 模拟磁盘丢失/恢复事故

        MvcResult health = mockMvc.perform(get("/api/attachments/health").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value((int) totalBefore + 1))
                .andExpect(jsonPath("$.missing").value((int) missingBefore + 1))
                .andExpect(jsonPath("$.missingItems[?(@.id == " + id + ")].originalName")
                        .value(org.hamcrest.Matchers.hasItem("会丢失的图.png")))
                .andExpect(jsonPath("$.missingItems[?(@.id == " + id + ")].noteId")
                        .value(org.hamcrest.Matchers.hasItem((int) noteId)))
                .andExpect(jsonPath("$.missingItems[?(@.id == " + id + ")].noteTitle")
                        .value(org.hamcrest.Matchers.hasItem("断链笔记")))
                .andReturn();
        long ok = jsonLong(health, "ok");
        assertEquals(jsonLong(health, "total") - jsonLong(health, "missing"), ok, "ok = total - missing");
    }

    @Test
    @DisplayName("体检：磁盘上有文件但表里没记录 → orphans 能列出来")
    void healthReportsOrphans() throws Exception {
        Path spaceDir = UPLOADS_DIR.resolve(String.valueOf(adminSpaceId));
        Files.createDirectories(spaceDir);
        Path orphan = spaceDir.resolve("orphan-" + System.nanoTime() + ".png");
        Files.write(orphan, pngBytes());
        try {
            String expected = adminSpaceId + "/" + orphan.getFileName();
            mockMvc.perform(get("/api/attachments/health").session(adminSession))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.orphans[?(@.storedName == '" + expected + "')].storedName")
                            .value(org.hamcrest.Matchers.hasItem(expected)));
        } finally {
            Files.deleteIfExists(orphan);
        }
    }

    @Test
    @DisplayName("体检：只扫当前空间（bob 看不到 alice 的缺失与孤儿）")
    void healthIsSpaceScoped() throws Exception {
        Path aliceOrphan = UPLOADS_DIR.resolve(String.valueOf(adminSpaceId))
                .resolve("alice-only-" + System.nanoTime() + ".png");
        Files.createDirectories(aliceOrphan.getParent());
        Files.write(aliceOrphan, pngBytes());
        try {
            mockMvc.perform(get("/api/attachments/health").session(memberSession))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.orphans[?(@.storedName == '"
                            + adminSpaceId + "/" + aliceOrphan.getFileName() + "')]").isEmpty())
                    .andExpect(jsonPath("$.total").value((int) jdbcTemplate.queryForObject(
                            "SELECT COUNT(*) FROM attachments WHERE space_id = ?",
                            Integer.class, memberSpaceId)));
        } finally {
            Files.deleteIfExists(aliceOrphan);
        }
    }

    /** 建一篇笔记（供体检报告里的 noteTitle 使用）。 */
    private long createNoteForAttachment(String title, String content) {
        jdbcTemplate.update("INSERT INTO notes (space_id, folder_id, title, content, excerpt, version,"
                        + " is_favorite, is_pinned, sort_order, created_at, updated_at, search_blob)"
                        + " VALUES (?, NULL, ?, ?, ?, 1, 0, 0, 0, ?, ?, ?)",
                adminSpaceId, title, content, content, Times.now(), Times.now(), title + " " + content);
        Long id = jdbcTemplate.queryForObject("SELECT MAX(id) FROM notes WHERE space_id = ?",
                Long.class, adminSpaceId);
        return id == null ? 0L : id;
    }

    private static List<Path> listFiles(Path root) throws IOException {
        if (!Files.isDirectory(root)) {
            return List.of();
        }
        try (Stream<Path> walk = Files.walk(root)) {
            return walk.filter(Files::isRegularFile).toList();
        }
    }

    private long countUploadedFiles(long spaceId) throws IOException {
        return listFiles(UPLOADS_DIR.resolve(String.valueOf(spaceId))).size();
    }

    private ResultActions upload(MockHttpSession session, String originalName, String contentType, byte[] content)
            throws Exception {
        return mockMvc.perform(multipart("/api/attachments")
                .file(new MockMultipartFile("file", originalName, contentType, content))
                .session(session));
    }

    private static byte[] pngBytes() {
        BufferedImage image = new BufferedImage(3, 2, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            ImageIO.write(image, "png", out);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }

    private static String sha256(byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
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
        return jdbcTemplate.queryForObject(
                "SELECT id FROM spaces WHERE owner_id = (SELECT id FROM users WHERE username = ?)",
                Long.class, username);
    }

    static String jsonText(MvcResult result, String key) throws Exception {
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        Matcher matcher = Pattern.compile("\"" + key + "\":\"([^\"]*)\"").matcher(body);
        assertTrue(matcher.find(), "响应里找不到字段 " + key + ": " + body);
        return matcher.group(1);
    }

    static long jsonLong(MvcResult result, String key) throws Exception {
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        Matcher matcher = Pattern.compile("\"" + key + "\":(\\d+)").matcher(body);
        assertTrue(matcher.find(), "响应里找不到字段 " + key + ": " + body);
        return Long.parseLong(matcher.group(1));
    }
}

package com.kb.ioport;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.kb.common.SearchText;
import com.kb.common.Times;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
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

/** API.md §10 导入导出：单篇导出、ZIP 结构、安全性（Zip Slip / 大小上限）与容错导入。 */
@SpringBootTest
@AutoConfigureMockMvc
class ImportExportApiTest {

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
            return Files.createTempDirectory("kb-ioport-");
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

    // ---------------------------------------------------------------- 单篇导出

    @Test
    @DisplayName("GET /api/export/notes/{id}.md：Markdown 正文 + attachment + 中文名 RFC 5987")
    void exportSingleNote() throws Exception {
        long folderId = seedFolder(null, "导出目录");
        long noteId = seedNote(folderId, "架构说明", "# 架构说明\n\n正文内容 ABC");

        MvcResult result = mockMvc.perform(get("/api/export/notes/" + noteId + ".md").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION,
                        org.hamcrest.Matchers.startsWith("attachment;")))
                .andReturn();
        String disposition = result.getResponse().getHeader(HttpHeaders.CONTENT_DISPOSITION);
        assertNotNull(disposition);
        assertTrue(disposition.contains("filename*=UTF-8''%E6%9E%B6%E6%9E%84%E8%AF%B4%E6%98%8E.md"),
                "中文文件名必须按 RFC 5987 编码: " + disposition);
        assertTrue(result.getResponse().getContentType().contains("text/markdown"),
                result.getResponse().getContentType());

        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertTrue(body.contains("title: \"架构说明\""), body);
        assertTrue(body.contains("folder: \"导出目录\""), "导出应带上目录信息: " + body);
        assertTrue(body.contains("# 架构说明"), body);
        assertTrue(body.contains("正文内容 ABC"), body);

        assertTrue(count("SELECT COUNT(*) FROM activities WHERE action = 'export' AND note_id = ?", noteId) >= 1);
        mockMvc.perform(get("/api/export/notes/" + noteId + ".md").session(memberSession))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/export/notes/999999.md").session(adminSession))
                .andExpect(status().isNotFound());
    }

    // ---------------------------------------------------------------- ZIP 导出

    @Test
    @DisplayName("GET /api/export/all：notes/{目录}/{标题}.md + attachments/ + manifest.json，重名与非法字符安全")
    void exportAllZipStructure() throws Exception {
        long tech = seedFolder(null, "技术");
        long java = seedFolder(tech, "Java");
        seedNote(java, "Java 笔记", "Spring 自动配置");
        seedNote(null, "根笔记", "没有目录");
        seedNote(null, "同名", "第一份");
        seedNote(null, "同名", "第二份");
        seedNote(null, "非法/字符:测试*?", "标题里有非法字符");
        long attachmentId = uploadAttachment("附件图.png");

        long expectedNotes = count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL", adminSpaceId);

        MvcResult result = mockMvc.perform(get("/api/export/all").session(adminSession))
                .andExpect(status().isOk())
                .andReturn();
        assertEquals("application/zip", result.getResponse().getContentType());
        assertTrue(result.getResponse().getHeader(HttpHeaders.CONTENT_DISPOSITION).startsWith("attachment;"));

        Map<String, byte[]> entries = readZip(result.getResponse().getContentAsByteArray());
        assertTrue(entries.containsKey("notes/技术/Java/Java 笔记.md"), entries.keySet().toString());
        assertTrue(entries.containsKey("notes/根笔记.md"), entries.keySet().toString());
        assertTrue(entries.containsKey("notes/同名.md"), entries.keySet().toString());
        assertTrue(entries.containsKey("notes/同名 (2).md"), "同名笔记必须能区分: " + entries.keySet());
        assertTrue(entries.containsKey("manifest.json"));

        String manifest = new String(entries.get("manifest.json"), StandardCharsets.UTF_8);
        assertTrue(manifest.contains("\"noteCount\": " + expectedNotes), manifest);
        assertTrue(manifest.contains("\"path\":\"notes/技术/Java/Java 笔记.md\""), manifest);
        assertTrue(manifest.contains("\"id\":" + attachmentId), manifest);

        for (String name : entries.keySet()) {
            if (name.startsWith("attachments/")) {
                continue;
            }
            assertFalse(name.matches(".*[\\\\:*?\"<>|].*"), "ZIP 路径不得含非法字符: " + name);
        }
        assertTrue(entries.keySet().stream().anyMatch(name -> name.startsWith("attachments/")),
                "附件必须打进 attachments/: " + entries.keySet());

        String javaNote = new String(entries.get("notes/技术/Java/Java 笔记.md"), StandardCharsets.UTF_8);
        assertTrue(javaNote.contains("folder: \"技术/Java\""), javaNote);

        Map<String, byte[]> memberEntries = readZip(mockMvc.perform(get("/api/export/all").session(memberSession))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
        assertTrue(memberEntries.keySet().stream().noneMatch(name -> name.contains("Java 笔记")),
                "bob 的导出不得包含 alice 的笔记: " + memberEntries.keySet());
    }

    // ---------------------------------------------------------------- 导入

    @Test
    @DisplayName("导入 3 个 .md → imported=3；preview 同名解析但入库前笔记数不变")
    void importThreeMarkdownFiles() throws Exception {
        long notesBefore = count("SELECT COUNT(*) FROM notes WHERE space_id = ?", adminSpaceId);
        MockMultipartFile[] files = {
                md("alpha.md", "内容 alpha 天气很好"),
                md("beta.md", "内容 beta"),
                md("gamma.md", "内容 gamma"),
        };

        mockMvc.perform(multipart("/api/import/preview").file(files[0]).file(files[1]).file(files[2])
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(3))
                .andExpect(jsonPath("$.items.length()").value(3))
                .andExpect(jsonPath("$.items[0].title").value("alpha"))
                .andExpect(jsonPath("$.items[0].sourceFile").value("alpha.md"))
                .andExpect(jsonPath("$.items[0].tags.length()").value(0))
                .andExpect(jsonPath("$.items[0].folder").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.items[0].sizeBytes").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.errors.length()").value(0));
        assertEquals(notesBefore, count("SELECT COUNT(*) FROM notes WHERE space_id = ?", adminSpaceId),
                "preview 不得入库");

        mockMvc.perform(multipart("/api/import/markdown").file(files[0]).file(files[1]).file(files[2])
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(3))
                .andExpect(jsonPath("$.skipped").value(0))
                .andExpect(jsonPath("$.errors.length()").value(0));

        assertEquals(1, count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND title = 'alpha'", adminSpaceId));
        assertEquals(3, count("SELECT COUNT(*) FROM activities a JOIN notes n ON n.id = a.note_id"
                + " WHERE a.action = 'import' AND n.title IN ('alpha','beta','gamma')"));
        assertEquals(1, matchCount("天气"), "导入的笔记必须能被 MATCH 搜到");
    }

    @Test
    @DisplayName("front matter 的 title/tags/folder 被采用，目录树与标签自动建立")
    void importAdoptsFrontMatter() throws Exception {
        String content = """
                ---
                title: 前端解析标题
                tags: [Java, 笔记]
                folder: 导入目录/子层
                author: 会被忽略
                ---

                # 正文标题

                正文内容
                """;
        mockMvc.perform(multipart("/api/import/preview")
                        .file(md("whatever.md", content)).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].title").value("前端解析标题"))
                .andExpect(jsonPath("$.items[0].folder").value("导入目录/子层"))
                .andExpect(jsonPath("$.items[0].tags[0]").value("Java"))
                .andExpect(jsonPath("$.items[0].tags[1]").value("笔记"));

        mockMvc.perform(multipart("/api/import/markdown").file(md("whatever.md", content)).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.errors.length()").value(0));

        Map<String, Object> note = jdbc.queryForMap(
                "SELECT * FROM notes WHERE space_id = ? AND title = '前端解析标题'", adminSpaceId);
        assertFalse(((String) note.get("content")).contains("title: 前端解析标题"), "front matter 不应留在正文里");
        long noteId = ((Number) note.get("id")).longValue();
        assertEquals(2, count("SELECT COUNT(*) FROM note_tags WHERE note_id = ?", noteId));
        assertEquals(1, count("SELECT COUNT(*) FROM folders f JOIN folders p ON p.id = f.parent_id"
                + " WHERE f.space_id = ? AND f.name = '子层' AND p.name = '导入目录'", adminSpaceId),
                "应按 folder 建立 导入目录/子层 两级目录");
    }

    @Test
    @DisplayName("1 个损坏的 md + 2 个正常的 → imported=2、errors 有 1 条，其余照常导入")
    void corruptedFileDoesNotAbortOthers() throws Exception {
        MockMultipartFile broken = new MockMultipartFile("file", "broken.md", "text/markdown",
                new byte[] {(byte) 0xC3, (byte) 0x28, (byte) 0xA0, (byte) 0xC3});
        mockMvc.perform(multipart("/api/import/preview").file(broken).file(md("good1.md", "好的一")).file(
                        md("good2.md", "好的二")).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.errors.length()").value(1))
                .andExpect(jsonPath("$.errors[0]", org.hamcrest.Matchers.containsString("编码")));

        mockMvc.perform(multipart("/api/import/markdown").file(broken).file(md("good1.md", "好的一")).file(
                        md("good2.md", "好的二")).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(2))
                .andExpect(jsonPath("$.errors.length()").value(1))
                .andExpect(jsonPath("$.errors[0]", org.hamcrest.Matchers.containsString("broken.md")))
                .andExpect(jsonPath("$.errors[0]", org.hamcrest.Matchers.containsString("编码")));
        assertEquals(1, count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND title = 'good1'", adminSpaceId));
        assertEquals(0, count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND title = 'broken'", adminSpaceId));
    }

    @Test
    @DisplayName("导入的 [[链接]] 生成 links 行：批次内 A 先于 B 导入，A.resolved 含 B、B.backlinks 含 A")
    void importedWikiLinksAreResolvedWithinBatch() throws Exception {
        // A 引用尚未导入的 B —— 只有「整批导完后回填」才能解析成功（回归测试：曾漏调 LinkService）
        mockMvc.perform(multipart("/api/import/markdown")
                        .file(md("linkA.md", "引用 [[linkB]] 的正文"))
                        .file(md("linkB.md", "被引用的正文"))
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(2))
                .andExpect(jsonPath("$.errors.length()").value(0));

        long noteA = noteIdByTitle("linkA");
        long noteB = noteIdByTitle("linkB");

        mockMvc.perform(get("/api/notes/" + noteA + "/links").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resolved[?(@.noteId == " + noteB + ")]").isNotEmpty())
                .andExpect(jsonPath("$.dangling").isEmpty());
        mockMvc.perform(get("/api/notes/" + noteB + "/backlinks").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.noteId == " + noteA + ")]").isNotEmpty());
        assertEquals(1, count("SELECT COUNT(*) FROM links WHERE source_note_id = ? AND target_note_id = ?",
                noteA, noteB), "links 行必须由导入建立（rebuild + backfillDangling）");
    }

    @Test
    @DisplayName("导入时目标不存在 → 先 dangling；目标随后导入 → 回填为 resolved")
    void importedLinksBackfillWhenTargetArrivesLater() throws Exception {
        mockMvc.perform(multipart("/api/import/markdown")
                        .file(md("linkC.md", "引用 [[linkD]] 的正文")).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1));
        long noteC = noteIdByTitle("linkC");
        mockMvc.perform(get("/api/notes/" + noteC + "/links").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resolved").isEmpty())
                .andExpect(jsonPath("$.dangling[0]").value("linkD"));
        assertEquals(0, count("SELECT COUNT(*) FROM links WHERE source_note_id = ? AND target_note_id IS NOT NULL",
                noteC));

        mockMvc.perform(multipart("/api/import/markdown")
                        .file(md("linkD.md", "后到的目标")).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1));
        long noteD = noteIdByTitle("linkD");
        mockMvc.perform(get("/api/notes/" + noteC + "/links").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resolved[?(@.noteId == " + noteD + ")]").isNotEmpty())
                .andExpect(jsonPath("$.dangling").isEmpty());
    }

    @Test
    @DisplayName("恶意 ZIP（../../evil.md）：条目被拒，其它条目照常导入，目标目录外无任何写入")
    void maliciousZipEntriesAreRejected() throws Exception {
        byte[] evilZip = zipOf(new String[][] {
                {"../../evil.md", "越界内容"},
                {"C:\\windows\\evil2.md", "盘符越界"},
                {"ok.md", "正常内容"},
        });

        mockMvc.perform(multipart("/api/import/markdown")
                        .file(new MockMultipartFile("file", "evil.zip", "application/zip", evilZip))
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.errors.length()").value(2))
                .andExpect(jsonPath("$.errors[0]", org.hamcrest.Matchers.containsString("非法路径")))
                .andExpect(jsonPath("$.errors[1]", org.hamcrest.Matchers.containsString("非法路径")));

        assertEquals(1, count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND title = 'ok'", adminSpaceId));
        assertEquals(0, count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND content = '越界内容'", adminSpaceId));

        assertFalse(Files.exists(Path.of("evil.md")), "不得在运行目录写出 evil.md");
        assertFalse(Files.exists(Path.of("..", "evil.md")), "不得在上级目录写出 evil.md");
        assertFalse(Files.exists(DATA_DIR.resolve("evil.md")), "不得在数据目录写出 evil.md");
        try (Stream<Path> walk = Files.walk(DATA_DIR)) {
            assertTrue(walk.noneMatch(path -> path.getFileName().toString().startsWith("evil")),
                    "数据目录里不得出现任何 evil* 文件");
        }
    }

    @Test
    @DisplayName("ZIP 内目录还原为笔记目录；非 md 条目跳过；不支持的文件报错；缺 file → 400")
    void zipFoldersAndUnsupportedInputs() throws Exception {
        byte[] zip = zipOf(new String[][] {
                {"notes/技术/深层笔记.md", "深层内容"},
                {"readme.txt", "不是笔记"},
        });
        mockMvc.perform(multipart("/api/import/markdown")
                        .file(new MockMultipartFile("file", "pack.zip", "application/zip", zip))
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.skipped").value(1))
                .andExpect(jsonPath("$.errors.length()").value(0));
        Long noteId = jdbc.queryForObject(
                "SELECT id FROM notes WHERE space_id = ? AND title = '深层笔记'", Long.class, adminSpaceId);
        assertNotNull(noteId);
        Map<String, Object> note = jdbc.queryForMap("SELECT folder_id FROM notes WHERE id = ?", noteId);
        long folderId = ((Number) note.get("folder_id")).longValue();
        assertEquals("技术", jdbc.queryForObject("SELECT name FROM folders WHERE id = ?", String.class, folderId));

        mockMvc.perform(multipart("/api/import/markdown")
                        .file(new MockMultipartFile("file", "a.docx", "application/vnd.ms-word",
                                "x".getBytes(StandardCharsets.UTF_8)))
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(0))
                .andExpect(jsonPath("$.errors[0]", org.hamcrest.Matchers.containsString("不支持的文件类型")));

        mockMvc.perform(multipart("/api/import/preview").session(adminSession))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("file"));
        mockMvc.perform(multipart("/api/import/markdown").session(adminSession))
                .andExpect(status().isBadRequest());
        mockMvc.perform(multipart("/api/import/preview")
                        .file(md("x.md", "x"))).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("导入可指定目标目录：裸笔记直接落入，自带目录变子目录，预览回显完整路径")
    void importIntoChosenFolder() throws Exception {
        long parent = seedFolder(null, "目标库");
        MockMultipartFile plain = md("裸笔记.md", "裸内容");
        // front matter 指定目录：导入时应变成目标目录的子目录
        MockMultipartFile nested = md("嵌套笔记.md", "---\nfolder: docs\n---\n嵌套内容");

        mockMvc.perform(multipart("/api/import/preview")
                        .file(plain).file(nested)
                        .param("targetFolderId", String.valueOf(parent))
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.items[0].folder").value("目标库"))
                .andExpect(jsonPath("$.items[1].folder").value("目标库/docs"));

        mockMvc.perform(multipart("/api/import/markdown")
                        .file(plain).file(nested)
                        .param("targetFolderId", String.valueOf(parent))
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(2));

        Long plainId = jdbc.queryForObject(
                "SELECT id FROM notes WHERE space_id = ? AND title = '裸笔记'", Long.class, adminSpaceId);
        Long nestedId = jdbc.queryForObject(
                "SELECT id FROM notes WHERE space_id = ? AND title = '嵌套笔记'", Long.class, adminSpaceId);
        assertNotNull(plainId);
        assertNotNull(nestedId);
        assertEquals(parent, folderIdOf(plainId));
        long nestedFolder = folderIdOf(nestedId);
        assertEquals("docs", jdbc.queryForObject("SELECT name FROM folders WHERE id = ?", String.class, nestedFolder));
        Object parentId = jdbc.queryForMap("SELECT parent_id FROM folders WHERE id = ?", nestedFolder).get("parent_id");
        assertEquals(parent, ((Number) parentId).longValue());

        // 目标目录不属于本空间 / 不存在 → 404，绝不擅自落到别处
        mockMvc.perform(multipart("/api/import/markdown")
                        .file(md("x.md", "x"))
                        .param("targetFolderId", "99999999")
                        .session(adminSession))
                .andExpect(status().isNotFound());
    }

    // ---------------------------------------------------------------- 工具

    private static MockMultipartFile md(String name, String content) {
        return new MockMultipartFile("file", name, "text/markdown", content.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] zipOf(String[][] entries) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out, StandardCharsets.UTF_8)) {
            for (String[] entry : entries) {
                zip.putNextEntry(new ZipEntry(entry[0]));
                zip.write(entry[1].getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }

    private static Map<String, byte[]> readZip(byte[] bytes) {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new java.io.ByteArrayInputStream(bytes),
                StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                entries.put(entry.getName(), zip.readAllBytes());
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return entries;
    }

    private long uploadAttachment(String originalName) throws Exception {
        MvcResult result = mockMvc.perform(multipart("/api/attachments")
                        .file(new MockMultipartFile("file", originalName, "image/png",
                                "fake-png-bytes".getBytes(StandardCharsets.UTF_8)))
                        .session(adminSession))
                .andExpect(status().isCreated())
                .andReturn();
        return jsonLong(result, "id");
    }

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

    private long noteIdByTitle(String title) {
        return jdbc.queryForObject("SELECT id FROM notes WHERE space_id = ? AND title = ?", Long.class,
                adminSpaceId, title);
    }

    private long folderIdOf(long noteId) {
        Object value = jdbc.queryForMap("SELECT folder_id FROM notes WHERE id = ?", noteId).get("folder_id");
        assertNotNull(value, "笔记应有目录");
        return ((Number) value).longValue();
    }

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

    private static long jsonLong(MvcResult result, String key) throws Exception {
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        Matcher matcher = Pattern.compile("\"" + key + "\":(\\d+)").matcher(body);
        assertTrue(matcher.find(), "响应里找不到字段 " + key + ": " + body);
        return Long.parseLong(matcher.group(1));
    }
}

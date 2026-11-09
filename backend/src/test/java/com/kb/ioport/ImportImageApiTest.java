package com.kb.ioport;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
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

/**
 * IMPORT-IMAGES.md §10 验收：ZIP / 文件夹 / 多选三种入口带图、缺图报告、导出往返与安全边界。
 */
@SpringBootTest
@AutoConfigureMockMvc
class ImportImageApiTest {

    private static final Path DATA_DIR = createDataDir();

    private static final String ADMIN = "alice";
    private static final String ADMIN_PASSWORD = "adminPass123";

    private static MockHttpSession adminSession;
    private static long adminSpaceId;

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    private static Path createDataDir() {
        try {
            return Files.createTempDirectory("kb-import-image-");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void ensureAccount() throws Exception {
        if (adminSession != null) {
            return;
        }
        mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(ADMIN, "爱丽丝", ADMIN_PASSWORD).getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isCreated());
        adminSession = login(ADMIN, ADMIN_PASSWORD);
        adminSpaceId = jdbc.queryForObject(
                "SELECT id FROM spaces WHERE owner_id = (SELECT id FROM users WHERE username = ?)",
                Long.class, ADMIN);
    }

    // ---------------------------------------------------------------- §10.1 ZIP 带图

    @Test
    @DisplayName("§10.1 ZIP 带图：引用重写为 /api/attachments/{id}，URL 取回字节与原图一致")
    void zipWithImagesUploadsAndRewrites() throws Exception {
        byte[] png = pngBytes();
        String title = "ZIP带图笔记";
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("notes/" + title + ".md",
                ("正文开始\n\n![我的图片](images/pic.png)\n\n![同级图](same.png)\n").getBytes(StandardCharsets.UTF_8));
        entries.put("notes/images/pic.png", png);
        entries.put("notes/same.png", png);

        mockMvc.perform(multipart("/api/import/markdown").file(zip("带图.zip", entries)).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.imagesImported").value(2))
                .andExpect(jsonPath("$.skipped").value(0))
                .andExpect(jsonPath("$.errors.length()").value(0))
                .andExpect(jsonPath("$.missingImages.length()").value(0));

        long noteId = latestNoteIdByTitle(title);
        String content = contentOf(noteId);
        assertTrue(!content.contains("images/pic.png") && !content.contains("same.png"),
                "相对引用必须被重写: " + content);
        List<Long> ids = attachmentIdsIn(content);
        assertEquals(2, ids.size(), content);
        for (long id : ids) {
            byte[] fetched = mockMvc.perform(get("/api/attachments/" + id).session(adminSession))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
            assertEquals(sha256(png), sha256(fetched), "取回的图必须与原图字节一致");
            assertEquals(noteId, ((Number) jdbc.queryForMap("SELECT note_id FROM attachments WHERE id = ?", id)
                    .get("note_id")).longValue(), "图片必须挂在这篇笔记上");
        }
        assertEquals(2, count("SELECT COUNT(*) FROM attachments WHERE note_id = ?", noteId),
                "这两张图必须落在这篇笔记上");
    }

    // ---------------------------------------------------------------- §10.2 文件夹

    @Test
    @DisplayName("§10.2 文件夹带图：filename 携带相对路径（webkitRelativePath）同样命中")
    void folderStyleRelativeFilenamesResolve() throws Exception {
        byte[] png = pngBytes();
        String title = "文件夹带图";
        MockMultipartFile md = new MockMultipartFile("file", "docs/" + title + ".md", "text/markdown",
                ("图片：\n\n![](images/pic.png)\n").getBytes(StandardCharsets.UTF_8));
        MockMultipartFile image = new MockMultipartFile("file", "docs/images/pic.png", "image/png", png);

        mockMvc.perform(multipart("/api/import/markdown").file(md).file(image).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.imagesImported").value(1))
                .andExpect(jsonPath("$.missingImages.length()").value(0));

        String content = contentOf(latestNoteIdByTitle(title));
        assertEquals(1, attachmentIdsIn(content).size(), content);
        assertTrue(!content.contains("images/pic.png"), content);
    }

    // ---------------------------------------------------------------- §10.3 多选

    @Test
    @DisplayName("§10.3 多选带图：目标只有文件名时按 basename 唯一匹配命中")
    void basenameMatchForFlatMultiSelect() throws Exception {
        byte[] png = pngBytes();
        String title = "多选带图";
        MockMultipartFile md = new MockMultipartFile("file", title + ".md", "text/markdown",
                "![](pic.png)\n".getBytes(StandardCharsets.UTF_8));
        MockMultipartFile image = new MockMultipartFile("file", "assets/pic.png", "image/png", png);

        mockMvc.perform(multipart("/api/import/markdown").file(md).file(image).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.imagesImported").value(1));

        String content = contentOf(latestNoteIdByTitle(title));
        assertEquals(1, attachmentIdsIn(content).size(), content);
    }

    // ---------------------------------------------------------------- §10.4 / §10.5

    @Test
    @DisplayName("§10.4 缺图：正文原样保留 + missingImages 有条目且 reason/line/target 正确")
    void missingImageIsReportedAndContentKept() throws Exception {
        String title = "缺图笔记";
        String body = "第一行\n第二行\n![缺图](images/nope.png)\n";
        MockMultipartFile md = new MockMultipartFile("file", title + ".md", "text/markdown",
                body.getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(multipart("/api/import/markdown").file(md).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.imagesImported").value(0))
                .andExpect(jsonPath("$.missingImages.length()").value(1))
                .andExpect(jsonPath("$.missingImages[0].sourceFile").value(title + ".md"))
                .andExpect(jsonPath("$.missingImages[0].title").value(title))
                .andExpect(jsonPath("$.missingImages[0].line").value(3))
                .andExpect(jsonPath("$.missingImages[0].target").value("images/nope.png"))
                .andExpect(jsonPath("$.missingImages[0].reason").value(MissingImage.REASON_NOT_FOUND));

        assertEquals(body, contentOf(latestNoteIdByTitle(title)), "未命中的引用必须原样保留");
    }

    @Test
    @DisplayName("§10.5 外部地址与 data: 跳过：不算缺失、不改写")
    void externalUrlsAreNotReported() throws Exception {
        String title = "外链笔记";
        String body = "![外链](https://example.com/x.png)\n\n![内联](data:image/png;base64,AAAA)\n\n"
                + "![本库](/api/attachments/1)\n";
        MockMultipartFile md = new MockMultipartFile("file", title + ".md", "text/markdown",
                body.getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(multipart("/api/import/markdown").file(md).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.imagesImported").value(0))
                .andExpect(jsonPath("$.missingImages.length()").value(0));
        assertEquals(body, contentOf(latestNoteIdByTitle(title)));
    }

    // ---------------------------------------------------------------- §10.6 / §10.7 导出往返

    @Test
    @DisplayName("§10.6/§7 导出往返：ZIP 内引用与条目逐字对应，重新导入后图重新挂上且可取出")
    void exportZipReferencesMatchEntriesAndReimportWorks() throws Exception {
        byte[] png = pngBytes();
        String title = "往返图笔记";
        mockMvc.perform(post("/api/notes").session(adminSession).contentType(MediaType.APPLICATION_JSON)
                        .content(("{\"title\":\"" + title + "\",\"content\":\"初始\"}")
                                .getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isCreated());
        long noteId = latestNoteIdByTitle(title);

        long plainId = uploadAttachment("导图 一.png", png, noteId);
        long htmlId = uploadAttachment("html图.png", png, noteId);
        String content = "Markdown 形式：\n\n![](/api/attachments/" + plainId + ")\n\nHTML 形式：\n\n"
                + "<img src=\"/api/attachments/" + htmlId + "\">\n";
        mockMvc.perform(patch("/api/notes/" + noteId).session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(("{\"content\":" + jsonString(content) + "}").getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk());

        byte[] zipBytes = mockMvc.perform(get("/api/export/all").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "application/zip"))
                .andReturn().getResponse().getContentAsByteArray();
        Map<String, byte[]> entries = readZip(zipBytes);

        String entryName = "attachments/" + plainId + "-导图 一.png";
        String htmlEntryName = "attachments/" + htmlId + "-html图.png";
        assertTrue(entries.containsKey(entryName), "附件必须打进来: " + entries.keySet());
        assertTrue(entries.containsKey(htmlEntryName), "附件必须打进来: " + entries.keySet());
        assertEquals(sha256(png), sha256(entries.get(entryName)), "ZIP 里的图必须与原图一致");

        String exported = new String(exportedMarkdownEntry(entries, title), StandardCharsets.UTF_8);
        // 该笔记在包内的位置是 notes/<标题>.md → 到包根的 attachments/ 是 ../attachments/...
        assertTrue(exported.contains("![](" + FileNames.markdownReference("notes/任意.md", entryName) + ")"),
                "Markdown 引用必须相对 md 所在目录: " + exported);
        assertTrue(exported.contains("src=\"" + FileNames.relativeToMd("notes/任意.md", htmlEntryName) + "\""),
                "HTML 形式应写相对路径（属性里不能有尖括号）: " + exported);
        assertTrue(!exported.contains("/api/attachments/"), "导出后不应残留本库绝对地址: " + exported);

        // §10.7 外部工具可渲染：按 Markdown 语义（相对该 md 所在目录）解析每个引用，
        // 都必须指向包内真实存在的文件
        // （正文里本来就有的、指向不存在文件的相对路径不在此列 —— 那是「未命中保留原文」的既定语义）
        Set<String> resolvedRefs = new HashSet<>();
        for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
            if (!entry.getKey().endsWith(".md")) {
                continue;
            }
            for (String reference : imageTargets(new String(entry.getValue(), StandardCharsets.UTF_8))) {
                if (reference.startsWith("../") || reference.startsWith("attachments/")) {
                    resolvedRefs.add(resolveReference(entry.getKey(), reference));
                }
            }
        }
        assertTrue(!resolvedRefs.isEmpty(), "导出的 md 里应当有重写后的附件引用");
        for (String resolved : resolvedRefs) {
            assertTrue(entries.containsKey(resolved), "引用解析后 " + resolved + " 在 ZIP 里找不到文件");
            assertTrue(entries.get(resolved).length > 0, "引用 " + resolved + " 对应空文件");
        }

        // §10.6 重新导入同一个 ZIP
        mockMvc.perform(multipart("/api/import/markdown")
                        .file(new MockMultipartFile("file", "round-trip.zip", "application/zip", zipBytes))
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.errors.length()").value(0));
        long reimportedId = latestNoteIdByTitle(title);
        assertTrue(reimportedId != noteId, "重新导入应产生新笔记");
        String reimported = contentOf(reimportedId);
        List<Long> newIds = attachmentIdsIn(reimported);
        assertEquals(2, newIds.size(), "重新导入后两张图都要重新挂上: " + reimported);
        for (long id : newIds) {
            byte[] fetched = mockMvc.perform(get("/api/attachments/" + id).session(adminSession))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
            assertEquals(sha256(png), sha256(fetched));
        }
    }

    @Test
    @DisplayName("§7 嵌套目录的笔记：引用带 ../ 前缀（两层目录 → ../../attachments/…），解压后可渲染")
    void nestedNoteUsesRelativePrefixes() throws Exception {
        byte[] png = pngBytes();
        String title = "深层图片笔记";
        long folderId = createFolder("深层目录");
        long noteId = createNote(title, folderId, "![图](x)");
        long attachmentId = uploadAttachment("深图.png", png, noteId);
        mockMvc.perform(patch("/api/notes/" + noteId).session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(("{\"content\":" + jsonString("![](/api/attachments/" + attachmentId + ")") + "}")
                                .getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk());

        Map<String, byte[]> entries = readZip(mockMvc.perform(get("/api/export/all").session(adminSession))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
        String mdPath = entries.keySet().stream().filter(name -> name.contains(title)).findFirst().orElseThrow();
        assertTrue(mdPath.startsWith("notes/深层目录/"), "笔记应在嵌套目录里: " + mdPath);

        String exported = new String(entries.get(mdPath), StandardCharsets.UTF_8);
        String reference = "../../attachments/" + attachmentId + "-深图.png";
        assertTrue(exported.contains("![](" + reference + ")"),
                "两层嵌套要用 ../../ 前缀（实际 mdPath=" + mdPath + "）: " + exported);
        assertEquals("attachments/" + attachmentId + "-深图.png", resolveReference(mdPath, reference),
                "解析后应回到包内条目名");
        assertTrue(entries.containsKey(resolveReference(mdPath, reference)), "包内必须有对应文件");
    }

    // ---------------------------------------------------------------- §10.9 预览不写库

    @Test
    @DisplayName("§10.9 预览不写库；imagesImported 是「将导入的图片数」（预告语义）")
    void previewDoesNotWriteAnything() throws Exception {
        byte[] png = pngBytes();
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("p/预览笔记.md", "![](img/a.png)\n\n![缺](img/missing.png)\n".getBytes(StandardCharsets.UTF_8));
        entries.put("p/img/a.png", png);
        long notesBefore = count("SELECT COUNT(*) FROM notes WHERE space_id = ?", adminSpaceId);
        long attachmentsBefore = count("SELECT COUNT(*) FROM attachments WHERE space_id = ?", adminSpaceId);

        mockMvc.perform(multipart("/api/import/preview").file(zip("preview.zip", entries)).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.imagesImported").value(1))
                .andExpect(jsonPath("$.missingImages.length()").value(1))
                .andExpect(jsonPath("$.missingImages[0].reason").value(MissingImage.REASON_NOT_FOUND));

        assertEquals(notesBefore, count("SELECT COUNT(*) FROM notes WHERE space_id = ?", adminSpaceId),
                "预览不得建笔记");
        assertEquals(attachmentsBefore, count("SELECT COUNT(*) FROM attachments WHERE space_id = ?", adminSpaceId),
                "预览不得上传附件");
        assertEquals(0, count("SELECT COUNT(*) FROM notes WHERE space_id = ? AND title = ?", adminSpaceId, "预览笔记"));
    }

    // ---------------------------------------------------------------- §10.10 / §10.11 边界

    @Test
    @DisplayName("§10.10 非法相对路径：..\\..\\x.png 与 ../../evil.md 一律拒绝且不产生笔记")
    void illegalRelativePathsAreRejected() throws Exception {
        long before = count("SELECT COUNT(*) FROM notes WHERE space_id = ?", adminSpaceId);
        MockMultipartFile image = new MockMultipartFile("file", "..\\..\\x.png", "image/png", pngBytes());
        MockMultipartFile md = new MockMultipartFile("file", "../../evil.md", "text/markdown",
                "x".getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(multipart("/api/import/markdown").file(image).file(md).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(0))
                .andExpect(jsonPath("$.imagesImported").value(0))
                .andExpect(jsonPath("$.errors.length()").value(2));

        assertEquals(before, count("SELECT COUNT(*) FROM notes WHERE space_id = ?", adminSpaceId));
        assertTrue(!Files.exists(Path.of("..", "evil.md")) && !Files.exists(Path.of("evil.md")));
    }

    @Test
    @DisplayName("§10.11 超过单文件上限的图片：不上传、记入 missingImages（理由：超过单文件上限）")
    void oversizedImageIsReportedAsMissing() throws Exception {
        String title = "大图笔记";
        byte[] huge = new byte[21 * 1024 * 1024];
        MockMultipartFile md = new MockMultipartFile("file", title + ".md", "text/markdown",
                "![大图](big.png)\n".getBytes(StandardCharsets.UTF_8));
        MockMultipartFile image = new MockMultipartFile("file", "big.png", "image/png", huge);

        mockMvc.perform(multipart("/api/import/markdown").file(md).file(image).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.imagesImported").value(0))
                .andExpect(jsonPath("$.missingImages.length()").value(1))
                .andExpect(jsonPath("$.missingImages[0].reason").value(MissingImage.REASON_TOO_LARGE));
        assertEquals("![大图](big.png)\n", contentOf(latestNoteIdByTitle(title)));
    }

    @Test
    @DisplayName("图片上传不影响同一篇笔记的 [[链接]]（PATCH 重写后链接仍在）")
    void imageRewriteKeepsWikiLinks() throws Exception {
        byte[] png = pngBytes();
        String target = "图片链接目标";
        String title = "图片带链接";
        MockMultipartFile md = new MockMultipartFile("file", title + ".md", "text/markdown",
                ("见 [[" + target + "]]\n\n![](pic.png)\n").getBytes(StandardCharsets.UTF_8));
        MockMultipartFile targetMd = new MockMultipartFile("file", target + ".md", "text/markdown",
                "目标正文".getBytes(StandardCharsets.UTF_8));
        MockMultipartFile image = new MockMultipartFile("file", "pic.png", "image/png", png);

        mockMvc.perform(multipart("/api/import/markdown").file(md).file(targetMd).file(image)
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(2))
                .andExpect(jsonPath("$.imagesImported").value(1));

        long sourceId = latestNoteIdByTitle(title);
        long targetId = latestNoteIdByTitle(target);
        mockMvc.perform(get("/api/notes/" + sourceId + "/links").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resolved[?(@.noteId == " + targetId + ")]").isNotEmpty())
                .andExpect(jsonPath("$.dangling").isEmpty());
    }

    @Test
    @DisplayName("§4 白名单外的图片类型（tiff）不上传，记入 missingImages（理由：不支持的图片类型）")
    void unsupportedImageTypeIsReported() throws Exception {
        String title = "TIFF笔记";
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("tiff/" + title + ".md", "![位图](img/a.tiff)\n".getBytes(StandardCharsets.UTF_8));
        entries.put("tiff/img/a.tiff", "II*\u0000".getBytes(StandardCharsets.ISO_8859_1));

        mockMvc.perform(multipart("/api/import/markdown").file(zip("tiff.zip", entries)).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.imagesImported").value(0))
                .andExpect(jsonPath("$.missingImages.length()").value(1))
                .andExpect(jsonPath("$.missingImages[0].reason").value(MissingImage.REASON_UNSUPPORTED_TYPE));
        assertEquals("![位图](img/a.tiff)\n", contentOf(latestNoteIdByTitle(title)),
                "不支持的图必须原样保留");
    }

    @Test
    @DisplayName("§4 白名单新增的 bmp / avif 正常上传（规则：加白名单后不再报不支持）")
    void bmpAndAvifAreSupported() throws Exception {
        String title = "BMP与AVIF";
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("fmt/" + title + ".md",
                "![位图](img/a.bmp)\n\n![次世代](img/b.avif)\n".getBytes(StandardCharsets.UTF_8));
        entries.put("fmt/img/a.bmp", "BM-bitmap".getBytes(StandardCharsets.ISO_8859_1));
        entries.put("fmt/img/b.avif", "avif-bytes".getBytes(StandardCharsets.ISO_8859_1));

        mockMvc.perform(multipart("/api/import/markdown").file(zip("fmt.zip", entries)).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imagesImported").value(2))
                .andExpect(jsonPath("$.missingImages.length()").value(0));

        List<Long> ids = attachmentIdsIn(contentOf(latestNoteIdByTitle(title)));
        assertEquals(2, ids.size());
        for (long id : ids) {
            mockMvc.perform(get("/api/attachments/" + id).session(adminSession)).andExpect(status().isOk());
        }
        assertEquals(1, count("SELECT COUNT(*) FROM attachments WHERE id = ? AND stored_name LIKE '%.bmp'", ids.get(0))
                + count("SELECT COUNT(*) FROM attachments WHERE id = ? AND stored_name LIKE '%.bmp'", ids.get(1)),
                "bmp 落盘扩展名应由 MIME 推导");
    }

    // ---------------------------------------------------------------- §10.0 单篇导出 ZIP

    @Test
    @DisplayName("§10.0 单篇 ZIP：恰好 md + 被引用的 2 张图 + manifest；未引用的图不打包；引用可解析")
    void singleNoteZipContainsOnlyReferencedAttachments() throws Exception {
        byte[] png = pngBytes();
        String title = "单篇ZIP结构";
        long folderId = createFolder(null, "单篇目录");
        long noteId = createNote(title, folderId, "初始");
        long first = uploadAttachment("被引用 图.png", png, noteId);
        long second = uploadAttachment("第二图.png", png, noteId);
        long unused = uploadAttachment("未引用.png", png, noteId);
        patchContent(noteId, "![](/api/attachments/" + first + ")\n\n<img src=\"/api/attachments/" + second + "\">\n");

        MvcResult result = mockMvc.perform(get("/api/export/notes/" + noteId + ".zip").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "application/zip"))
                .andReturn();
        String disposition = result.getResponse().getHeader(HttpHeaders.CONTENT_DISPOSITION);
        assertTrue(disposition.startsWith("attachment;") && disposition.contains(".zip"), disposition);

        Map<String, byte[]> entries = readZip(result.getResponse().getContentAsByteArray());
        String firstEntry = "attachments/" + first + "-被引用 图.png";
        String secondEntry = "attachments/" + second + "-第二图.png";
        assertEquals(Set.of(title + ".md", firstEntry, secondEntry, "manifest.json"), entries.keySet(),
                "实际条目: " + entries.keySet());
        assertTrue(entries.keySet().stream().noneMatch(name -> name.contains("未引用")),
                "上传过但正文没引用的附件不得打包: " + entries.keySet());
        assertTrue(entries.keySet().stream().noneMatch(name -> name.contains(String.valueOf(unused) + "-")),
                entries.keySet().toString());

        String md = new String(entries.get(title + ".md"), StandardCharsets.UTF_8);
        assertTrue(!md.contains("/api/attachments/"), "引用必须重写: " + md);
        assertTrue(md.contains("![](<" + firstEntry + ">)"), "含空格的条目名要用 <> 包裹: " + md);
        assertTrue(md.contains("src=\"" + secondEntry + "\""), "HTML 形式不带尖括号: " + md);
        // 按「相对 md 所在目录」解析，每条引用都要落到包内真实条目
        for (String reference : imageTargets(md)) {
            String resolved = resolveReference(title + ".md", reference);
            assertTrue(entries.containsKey(resolved), "引用 " + reference + " → " + resolved + " 不在包内");
            assertEquals(sha256(png), sha256(entries.get(resolved)));
        }
        String manifest = new String(entries.get("manifest.json"), StandardCharsets.UTF_8);
        assertTrue(manifest.contains("\"noteCount\": 1"), manifest);
        assertTrue(manifest.contains("\"attachmentCount\": 2"), manifest);
    }

    @Test
    @DisplayName("§10.0 单篇 ZIP 往返：正文/图片/标签/目录/双链/front matter 六项一致")
    void singleNoteZipRoundTripKeepsEverything() throws Exception {
        byte[] png = pngBytes();
        String title = "往返完整性";
        String linkTarget = "往返双链目标";
        long parent = createFolder(null, "往返父");
        long child = createFolder(parent, "往返子");
        long noteId = createNote(title, child, "初始");
        long first = uploadAttachment("图一.png", png, noteId);
        long second = uploadAttachment("图二.png", png, noteId);
        String original = "引用 [[" + linkTarget + "]] 的正文\n\n![](/api/attachments/" + first + ")\n\n"
                + "<img src=\"/api/attachments/" + second + "\">\n";
        patchContent(noteId, original);
        setTags(noteId, "标签甲", "标签乙");

        byte[] zip = exportNoteZip(noteId);
        Map<String, byte[]> entries = readZip(zip);
        String md = new String(entries.get(title + ".md"), StandardCharsets.UTF_8);
        // ⑥ front matter 元数据
        assertTrue(md.contains("title: \"" + title + "\""), md);
        assertTrue(md.contains("tags: ["), md);
        assertTrue(md.contains("\"标签甲\"") && md.contains("\"标签乙\""), md);
        assertTrue(md.contains("folder: \"往返父/往返子\""), md);

        mockMvc.perform(multipart("/api/import/markdown")
                        .file(new MockMultipartFile("file", "single.zip", "application/zip", zip))
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.errors.length()").value(0));
        long reimportedId = latestNoteIdByTitle(title);
        assertTrue(reimportedId != noteId, "重新导入应产生新笔记");

        // ① 正文：附件 id 归一化后逐字一致
        String reimported = contentOf(reimportedId);
        assertEquals(normalizeAttachmentIds(original), normalizeAttachmentIds(reimported), reimported);

        // ② 图片：两张都在、字节一致、可取回
        List<Long> newIds = attachmentIdsIn(reimported);
        assertEquals(2, newIds.size(), reimported);
        for (long id : newIds) {
            byte[] fetched = mockMvc.perform(get("/api/attachments/" + id).session(adminSession))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
            assertEquals(sha256(png), sha256(fetched));
        }

        // ③ 标签
        mockMvc.perform(get("/api/notes/" + reimportedId).session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tags[?(@.name == '标签甲')]").isNotEmpty())
                .andExpect(jsonPath("$.tags[?(@.name == '标签乙')]").isNotEmpty());

        // ④ 所在目录
        assertEquals("往返父/往返子", folderPathOf(reimportedId), "目录层级必须一致");

        // ⑤ [[双链]] 文本保留，且出链被记录（目标未随包导入 → dangling）
        assertTrue(reimported.contains("[[" + linkTarget + "]]"), reimported);
        mockMvc.perform(get("/api/notes/" + reimportedId + "/links").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dangling[?(@ == '" + linkTarget + "')]").isNotEmpty());
    }

    @Test
    @DisplayName("§10.0 无图笔记的单篇 ZIP 仍是合法 ZIP（md + manifest），能正常导入")
    void singleNoteZipWithoutImagesIsValid() throws Exception {
        String title = "无图笔记导出";
        long noteId = createNote(title, null, "纯文字正文，没有任何图片引用\n");
        byte[] zip = exportNoteZip(noteId);
        Map<String, byte[]> entries = readZip(zip);
        assertEquals(Set.of(title + ".md", "manifest.json"), entries.keySet(), entries.keySet().toString());

        mockMvc.perform(multipart("/api/import/markdown")
                        .file(new MockMultipartFile("file", "plain.zip", "application/zip", zip))
                        .session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.imagesImported").value(0))
                .andExpect(jsonPath("$.errors.length()").value(0));
    }

    @Test
    @DisplayName("§10.0 脏数据：附件记录存在但磁盘文件丢了 → 跳过该张、不报 500、md 保留原引用")
    void singleNoteZipSkipsMissingAttachmentFile() throws Exception {
        byte[] png = pngBytes();
        String title = "附件丢失笔记";
        long noteId = createNote(title, null, "初始");
        long attachmentId = uploadAttachment("会丢的图.png", png, noteId);
        patchContent(noteId, "![](/api/attachments/" + attachmentId + ")\n");
        String storedName = jdbc.queryForObject("SELECT stored_name FROM attachments WHERE id = ?",
                String.class, attachmentId);
        Path stored = DATA_DIR.resolve("uploads").resolve(storedName);
        byte[] keep = Files.readAllBytes(stored);
        assertTrue(Files.deleteIfExists(stored), "测试前置：删掉磁盘文件 " + stored);
        try {
            Map<String, byte[]> entries = readZip(exportNoteZip(noteId));
            assertEquals(Set.of(title + ".md", "manifest.json"), entries.keySet(), entries.keySet().toString());
            String md = new String(entries.get(title + ".md"), StandardCharsets.UTF_8);
            assertTrue(md.contains("/api/attachments/" + attachmentId), "文件丢了就保留原引用: " + md);
        } finally {
            // 同一测试类共享一个空间，别让后面的全量导出用例踩到「文件被删」
            Files.write(stored, keep);
        }
    }

    @Test
    @DisplayName("§10 单篇 .md 导出行为不变：仍只有正文 + 相对路径引用（无 ../，无附件）")
    void legacyMarkdownExportStaysTextOnly() throws Exception {
        byte[] png = pngBytes();
        String title = "兼容MD导出";
        long noteId = createNote(title, null, "初始");
        long attachmentId = uploadAttachment("兼容图.png", png, noteId);
        patchContent(noteId, "![](/api/attachments/" + attachmentId + ")\n");

        MvcResult result = mockMvc.perform(get("/api/export/notes/" + noteId + ".md").session(adminSession))
                .andExpect(status().isOk())
                .andReturn();
        assertTrue(result.getResponse().getContentType().contains("text/markdown"),
                result.getResponse().getContentType());
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertTrue(body.startsWith("---\ntitle: \"" + title + "\""), body);
        assertTrue(body.contains("![](" + FileNames.markdownReference(title + ".md",
                "attachments/" + attachmentId + "-兼容图.png") + ")"), body);
        assertTrue(!body.contains("../"), "单篇 .md 的虚拟根就是它自己，不该有 ../: " + body);
    }

    @Test
    @DisplayName("§7 安全：stored_name 含 .. 的脏记录不会被读出包外文件，也不会出现在 ZIP 里")
    void singleNoteZipDefendsAgainstStoredNameTraversal() throws Exception {
        String title = "越界记录笔记";
        long noteId = createNote(title, null, "初始");
        jdbc.update("INSERT INTO attachments (space_id, note_id, stored_name, original_name, mime_type,"
                        + " size_bytes, sha256, created_at)"
                        + " VALUES (?, ?, '../../etc/evil.png', 'evil.png', 'image/png', 8, 'x',"
                        + " '2026-10-17T00:00:00Z')", adminSpaceId, noteId);
        long evilId = jdbc.queryForObject(
                "SELECT id FROM attachments WHERE stored_name = '../../etc/evil.png'", Long.class);
        patchContent(noteId, "![](/api/attachments/" + evilId + ")\n");

        Map<String, byte[]> entries = readZip(exportNoteZip(noteId));
        assertEquals(Set.of(title + ".md", "manifest.json"), entries.keySet(), entries.keySet().toString());
        assertTrue(entries.keySet().stream().noneMatch(name -> name.contains("evil")),
                entries.keySet().toString());
        String md = new String(entries.get(title + ".md"), StandardCharsets.UTF_8);
        assertTrue(md.contains("/api/attachments/" + evilId), "越界记录保留原引用即可: " + md);

        // 清理：这条脏记录与这篇笔记不留给同类里其它用例（它们共享同一个空间）
        jdbc.update("DELETE FROM attachments WHERE id = ?", evilId);
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/api/notes/" + noteId).session(adminSession))
                .andExpect(status().isNoContent());
    }

    // ---------------------------------------------------------------- 工具

    private byte[] exportNoteZip(long noteId) throws Exception {
        return mockMvc.perform(get("/api/export/notes/" + noteId + ".zip").session(adminSession))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
    }

    private void patchContent(long noteId, String content) throws Exception {
        mockMvc.perform(patch("/api/notes/" + noteId).session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(("{\"content\":" + jsonString(content) + "}").getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk());
    }

    private void setTags(long noteId, String... names) throws Exception {
        StringBuilder json = new StringBuilder("[");
        for (int i = 0; i < names.length; i++) {
            json.append(i == 0 ? "" : ",").append(jsonString(names[i]));
        }
        json.append(']');
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .put("/api/notes/" + noteId + "/tags").session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(("{\"tagNames\":" + json + "}").getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk());
    }

    /** 目录路径（{@code 父/子}）；未分类返回 null。 */
    private String folderPathOf(long noteId) {
        Long folderId = jdbc.query("SELECT folder_id FROM notes WHERE id = ?", rs -> {
            if (!rs.next()) {
                return null;
            }
            long value = rs.getLong(1);
            return rs.wasNull() ? null : value;
        }, noteId);
        if (folderId == null) {
            return null;
        }
        Map<Long, String[]> folders = new java.util.HashMap<>();
        jdbc.query("SELECT id, parent_id, name FROM folders WHERE space_id = ?", rs -> {
            long id = rs.getLong("id");
            long parentRaw = rs.getLong("parent_id");
            boolean parentIsNull = rs.wasNull();
            String name = rs.getString("name");
            folders.put(id, new String[] {name, parentIsNull ? null : String.valueOf(parentRaw)});
        }, adminSpaceId);
        StringBuilder path = new StringBuilder();
        Long cursor = folderId;
        while (cursor != null) {
            String[] folder = folders.get(cursor);
            if (folder == null) {
                break;
            }
            path.insert(0, path.length() == 0 ? folder[0] : folder[0] + "/");
            cursor = folder[1] == null ? null : Long.valueOf(folder[1]);
        }
        return path.toString();
    }

    private static String normalizeAttachmentIds(String content) {
        return content == null ? "" : content.replaceAll("/api/attachments/\\d+", "/api/attachments/{id}");
    }


    private static MockMultipartFile zip(String name, Map<String, byte[]> entries) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream archive = new ZipOutputStream(out, StandardCharsets.UTF_8)) {
            for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
                archive.putNextEntry(new ZipEntry(entry.getKey()));
                archive.write(entry.getValue());
                archive.closeEntry();
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return new MockMultipartFile("file", name, "application/zip", out.toByteArray());
    }

    private static Map<String, byte[]> readZip(byte[] bytes) {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        try (ZipInputStream archive = new ZipInputStream(new ByteArrayInputStream(bytes),
                StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = archive.getNextEntry()) != null) {
                entries.put(entry.getName(), archive.readAllBytes());
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return entries;
    }

    /** 取导出包里正文对应的那个 .md 条目（按 front matter 的 title 找）。 */
    private static byte[] exportedMarkdownEntry(Map<String, byte[]> entries, String title) {
        for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
            if (entry.getKey().endsWith(".md")
                    && new String(entry.getValue(), StandardCharsets.UTF_8).contains("title: \"" + title + "\"")) {
                return entry.getValue();
            }
        }
        throw new AssertionError("导出包里找不到标题为 " + title + " 的 md 条目: " + entries.keySet());
    }

    /** §10.7：把 markdown 里的图片目标抓出来（去掉尖括号包裹），排除外部地址。 */
    private static List<String> imageTargets(String markdown) {
        List<String> targets = new ArrayList<>();
        Matcher matcher = Pattern.compile("!\\[[^\\]]*\\]\\(\\s*<?([^\\s)>]+(?:\\s[^)>]*)?)>?\\s*\\)").matcher(markdown);
        while (matcher.find()) {
            String target = matcher.group(1).trim().replace("\"", "");
            if (target.startsWith("http") || target.startsWith("data:")) {
                continue;
            }
            targets.add(target);
        }
        return targets;
    }

    private long createFolder(String name) throws Exception {
        return createFolder(null, name);
    }

    private long createFolder(Long parentId, String name) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/folders").session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(("{\"parentId\":" + (parentId == null ? "null" : parentId)
                                + ",\"name\":" + jsonString(name) + "}").getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isCreated())
                .andReturn();
        return jsonLong(result, "id");
    }

    private long createNote(String title, Long folderId, String content) throws Exception {
        String body = "{\"folderId\":" + (folderId == null ? "null" : folderId)
                + ",\"title\":" + jsonString(title) + ",\"content\":" + jsonString(content) + "}";
        MvcResult result = mockMvc.perform(post("/api/notes").session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body.getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isCreated())
                .andReturn();
        return jsonLong(result, "id");
    }

    /** §10.7：按 Markdown 语义把引用相对 md 所在目录解析成包内路径。 */
    private static String resolveReference(String mdPath, String reference) {
        Path parent = Path.of(mdPath).getParent();
        Path target = parent == null ? Path.of(reference) : parent.resolve(reference);
        return target.normalize().toString().replace('\\', '/');
    }

    private List<Long> attachmentIdsIn(String content) {
        List<Long> ids = new ArrayList<>();
        Matcher matcher = Pattern.compile("/api/attachments/(\\d+)").matcher(content);
        while (matcher.find()) {
            ids.add(Long.parseLong(matcher.group(1)));
        }
        return ids;
    }

    private long uploadAttachment(String originalName, byte[] bytes, long noteId) throws Exception {
        MvcResult result = mockMvc.perform(multipart("/api/attachments")
                        .file(new MockMultipartFile("file", originalName, "image/png", bytes))
                        .param("noteId", String.valueOf(noteId))
                        .session(adminSession))
                .andExpect(status().isCreated())
                .andReturn();
        return jsonLong(result, "id");
    }

    private String contentOf(long noteId) {
        return jdbc.queryForObject("SELECT content FROM notes WHERE id = ?", String.class, noteId);
    }

    private long latestNoteIdByTitle(String title) {
        return jdbc.queryForObject("SELECT id FROM notes WHERE space_id = ? AND title = ? ORDER BY id DESC LIMIT 1",
                Long.class, adminSpaceId, title);
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

    private static String jsonString(String text) {
        return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0 : value;
    }

    private static String registerBody(String username, String displayName, String password) {
        return "{\"username\":\"%s\",\"displayName\":\"%s\",\"password\":\"%s\",\"inviteCode\":null}"
                .formatted(username, displayName, password);
    }

    private MockHttpSession login(String username, String password) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"%s\",\"password\":\"%s\"}".formatted(username, password)
                                .getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);
        assertNotNull(session);
        return session;
    }

    private static long jsonLong(MvcResult result, String key) throws Exception {
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        Matcher matcher = Pattern.compile("\"" + key + "\":(\\d+)").matcher(body);
        assertTrue(matcher.find(), "响应里找不到字段 " + key + ": " + body);
        return Long.parseLong(matcher.group(1));
    }
}

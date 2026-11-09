package com.kb.ioport;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** front matter 解析、Zip Slip 路径判定与文件名清洗的纯单元测试。 */
class MarkdownFrontMatterTest {

    @Test
    @DisplayName("front matter：title/tags(内联与块列表)/folder，正文剥掉分隔线")
    void parsesFrontMatter() {
        MarkdownFrontMatter.Parsed parsed = MarkdownFrontMatter.parse("""
                ---
                title: "带引号的标题"
                tags: [Java, 笔记]
                folder: 技术/Java
                ---

                # 正文
                """);
        assertEquals("带引号的标题", parsed.frontMatter().title());
        assertEquals(List.of("Java", "笔记"), parsed.frontMatter().tags());
        assertEquals("技术/Java", parsed.frontMatter().folder());
        // front matter 与正文之间的空行属于分隔符，不算正文（否则往返后正文会多出一个换行）
        assertTrue(parsed.body().startsWith("# 正文"), parsed.body());

        MarkdownFrontMatter.Parsed blockList = MarkdownFrontMatter.parse("""
                ---
                title: 块列表
                tags:
                  - 一
                  - 二
                ---
                正文
                """);
        assertEquals(List.of("一", "二"), blockList.frontMatter().tags());
        assertEquals("正文", blockList.body().strip());
    }

    @Test
    @DisplayName("没有 front matter / 未闭合的 --- 都按普通正文处理")
    void toleratesMissingFrontMatter() {
        MarkdownFrontMatter.Parsed plain = MarkdownFrontMatter.parse("# 标题\n正文");
        assertNull(plain.frontMatter().title());
        assertEquals("# 标题\n正文", plain.body());

        String unclosed = "---\ntitle: 没有结束\n正文";
        assertEquals(unclosed, MarkdownFrontMatter.parse(unclosed).body());

        assertEquals("---", MarkdownFrontMatter.parse("---").body());
        assertEquals("", MarkdownFrontMatter.parse("").body());
    }

    @Test
    @DisplayName("H1 提取：取第一个一级标题，跳过围栏代码块内的 #")
    void extractsFirstHeading() {
        assertEquals("真标题", MarkdownText.firstHeading("```\n# 代码里的\n```\n\n# 真标题\n"));
        assertNull(MarkdownText.firstHeading("正文没有标题"));
        assertNull(MarkdownText.firstHeading("## 二级标题不算"));
        assertEquals("标题", MarkdownText.firstHeading("## 二级\n# 标题\n# 第二个"));
    }

    @Test
    @DisplayName("Zip Slip：绝对路径、.. 越界、盘符一律拒绝；正常相对路径放行")
    void rejectsZipSlipEntries() {
        assertNull(ImportService.safeEntryPath("../../evil.md"));
        assertNull(ImportService.safeEntryPath("..\\evil.md"));
        assertNull(ImportService.safeEntryPath("/etc/passwd"));
        assertNull(ImportService.safeEntryPath("\\windows\\evil.md"));
        assertNull(ImportService.safeEntryPath("C:\\windows\\evil.md"));
        assertNull(ImportService.safeEntryPath("notes/../../evil.md"));
        assertNull(ImportService.safeEntryPath(""));
        assertNull(ImportService.safeEntryPath("a\0b.md"));

        assertEquals("ok.md", ImportService.safeEntryPath("ok.md"));
        assertEquals("notes/技术/a.md", ImportService.safeEntryPath("notes/技术/a.md"));
        assertEquals("notes/a/../b.md", ImportService.safeEntryPath("notes/a/../b.md"));
    }

    @Test
    @DisplayName("文件名清洗：非法字符替换、结尾点去掉、同名去重、RFC 5987 编码")
    void sanitizesAndEncodesNames() {
        assertEquals("非法_字符_测试__", FileNames.sanitizeSegment("非法/字符:测试*?"));
        assertEquals("untitled", FileNames.sanitizeSegment("..."));
        assertEquals("note-7", FileNames.sanitizeFileName("   ", 7));
        assertTrue(FileNames.sanitizeSegment("a".repeat(200)).length() <= 80);

        java.util.Set<String> used = new java.util.HashSet<>();
        assertEquals("notes/x.md", FileNames.uniqueEntryPath(used, "notes/x.md"));
        assertEquals("notes/x (2).md", FileNames.uniqueEntryPath(used, "notes/x.md"));
        assertEquals("notes/x (3).md", FileNames.uniqueEntryPath(used, "notes/x.md"));
        assertEquals("notes/X (4).md", FileNames.uniqueEntryPath(used, "notes/X.md"),
                "Windows 解压不区分大小写，重名判定也应忽略大小写");

        assertEquals("%E6%9E%B6%E6%9E%84%E5%9B%BE.png", FileNames.rfc5987("架构图.png"));
        assertTrue(FileNames.attachmentDisposition("架构图.png")
                .startsWith("attachment; filename=\"___.png\"; filename*=UTF-8''%E6%9E%B6"));
    }

    @Test
    @DisplayName("编码识别：UTF-8 BOM 与 UTF-16 可用，非法字节序列报错")
    void decodesSupportedEncodings() {
        assertEquals("中文", ImportService.decodeText(new byte[] {
                (byte) 0xEF, (byte) 0xBB, (byte) 0xBF, (byte) 0xE4, (byte) 0xB8, (byte) 0xAD, (byte) 0xE6, (byte) 0x96,
                (byte) 0x87}));
        byte[] utf16 = "中文".getBytes(java.nio.charset.StandardCharsets.UTF_16LE);
        byte[] withBom = new byte[utf16.length + 2];
        withBom[0] = (byte) 0xFF;
        withBom[1] = (byte) 0xFE;
        System.arraycopy(utf16, 0, withBom, 2, utf16.length);
        assertEquals("中文", ImportService.decodeText(withBom));

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> ImportService.decodeText(new byte[] {(byte) 0xC3, (byte) 0x28}));
        assertTrue(error.getMessage().contains("编码无法识别"));
    }
}

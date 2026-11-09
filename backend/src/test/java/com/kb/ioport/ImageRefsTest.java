package com.kb.ioport;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** IMPORT-IMAGES.md §3 引用解析 / §3.3 归一化 / §3.4 匹配 / §7 导出重写的纯单元测试。 */
class ImageRefsTest {

    @Test
    @DisplayName("§3.1 识别内联、尖括号、带 title 与 <img> 四种写法，并给出正确行号")
    void parsesSupportedForms() {
        String markdown = """
                第一行
                ![我的图片](images/pic.png)
                ![带标题](images/b.png "标题")
                ![](<images/带 空格.png>)
                <img src="images/c.png" alt="x">
                <IMG SRC='images/d.png'>
                """;
        ImageRefs.Result result = ImageRefs.parse(markdown);
        List<String> targets = result.refs().stream().map(ImageRefs.Ref::target).toList();
        assertEquals(List.of("images/pic.png", "images/b.png", "images/带 空格.png", "images/c.png",
                "images/d.png"), targets);
        assertEquals(2, result.refs().get(0).line());
        assertEquals(3, result.refs().get(1).line());
        assertEquals(5, result.refs().get(3).line());
        assertTrue(result.unsupported().isEmpty());
    }

    @Test
    @DisplayName("§3.1 引用式写法只报告不改写")
    void reportsReferenceStyle() {
        ImageRefs.Result result = ImageRefs.parse("![别名][ref]\n\n[ref]: images/x.png");
        assertTrue(result.refs().isEmpty());
        assertEquals(1, result.unsupported().size());
        assertEquals(MissingImage.REASON_REFERENCE_STYLE, result.unsupported().get(0).reason());
        assertEquals(1, result.unsupported().get(0).line());
    }

    @Test
    @DisplayName("§3.2 外部地址 / data: / 本库附件地址一律跳过")
    void skipsExternalTargets() {
        assertTrue(ImageRefs.isExternallyHandled("https://example.com/x.png"));
        assertTrue(ImageRefs.isExternallyHandled("http://example.com/x.png"));
        assertTrue(ImageRefs.isExternallyHandled("//cdn.example.com/x.png"));
        assertTrue(ImageRefs.isExternallyHandled("data:image/png;base64,AAAA"));
        assertTrue(ImageRefs.isExternallyHandled("/api/attachments/3"));
        assertTrue(ImageRefs.isExternallyHandled("  "));
        assertTrue(!ImageRefs.isExternallyHandled("images/pic.png"));
        assertTrue(!ImageRefs.isExternallyHandled("./pic.png"));
    }

    @Test
    @DisplayName("§3.3 相对 mdPath 归一化：./ ../ 绝对路径 百分号编码 query/fragment")
    void normalizesTargets() {
        assertEquals("notes/images/pic.png", ImageRefs.normalizeTarget("notes/a.md", "images/pic.png"));
        assertEquals("notes/same.png", ImageRefs.normalizeTarget("notes/a.md", "./same.png"));
        assertEquals("notes/img/x.png", ImageRefs.normalizeTarget("notes/sub/a.md", "../img/x.png"));
        assertEquals("root/x.png", ImageRefs.normalizeTarget("notes/a.md", "/root/x.png"));
        assertEquals("images/pic.png", ImageRefs.normalizeTarget("a.md", "images/pic.png"));
        assertEquals("notes/images/架构 图.png",
                ImageRefs.normalizeTarget("notes/a.md", "images/%E6%9E%B6%E6%9E%84%20%E5%9B%BE.png"));
        assertEquals("notes/images/a.png", ImageRefs.normalizeTarget("notes/a.md", "images/a.png?x=1#frag"));
        assertEquals("notes/a+b.png", ImageRefs.normalizeTarget("notes/a.md", "a+b.png"));
    }

    @Test
    @DisplayName("§3.3 越界 ../.. 与盘符判为非法路径")
    void rejectsEscapingTargets() {
        assertEquals(MissingImage.REASON_ILLEGAL_PATH, assertThrows(IllegalArgumentException.class,
                () -> ImageRefs.normalizeTarget("a.md", "../../x.png")).getMessage());
        assertEquals(MissingImage.REASON_ILLEGAL_PATH, assertThrows(IllegalArgumentException.class,
                () -> ImageRefs.normalizeTarget("notes/a.md", "../../../x.png")).getMessage());
        assertEquals(MissingImage.REASON_ILLEGAL_PATH, assertThrows(IllegalArgumentException.class,
                () -> ImageRefs.normalizeTarget("a.md", "C:/windows/x.png")).getMessage());
    }

    @Test
    @DisplayName("§3.4 匹配顺序：精确 → 大小写不敏感 → basename 唯一；同名多个算未命中")
    void matchesInOrderAndRefusesAmbiguousBasename() {
        AssetIndex index = new AssetIndex();
        index.put("notes/images/pic.png", new byte[] {1});
        index.put("notes/SAME.PNG", new byte[] {2});

        assertNotNull(index.match("notes/images/pic.png"));
        assertEquals("notes/images/pic.png", index.match("notes/images/pic.png").path());
        assertEquals("notes/SAME.PNG", index.match("notes/same.png").path(), "大小写不敏感命中");
        assertEquals("notes/images/pic.png", index.match("other/pic.png").path(), "basename 唯一匹配");
        assertNull(index.match("other/nope.png"));
        assertEquals(0, index.unreferencedCount(), "三条引用都指向了索引里的文件");

        index.put("deep/pic.png", new byte[] {3});
        assertNull(index.match("third/pic.png"), "同名多个时不得猜，必须算未命中");
    }

    @Test
    @DisplayName("§2 filename 相对路径归一化：接受子目录，拒绝 .. 与盘符")
    void normalizesUploadPaths() {
        assertEquals("docs/images/a.png", ImportService.normalizeUploadPath("docs\\images\\a.png"));
        assertEquals("a.png", ImportService.normalizeUploadPath("./a.png"));
        assertEquals("docs/a.md", ImportService.normalizeUploadPath("docs/a.md"));
        assertNull(ImportService.normalizeUploadPath("../../x.png"));
        assertNull(ImportService.normalizeUploadPath("C:\\x.png"));
        assertNull(ImportService.normalizeUploadPath("/etc/x.png"));
        assertNull(ImportService.normalizeUploadPath("docs/../../x.png"));
    }

    @Test
    @DisplayName("§7 附件条目名与正文目标一致；含空格时用 <...> 包裹（不做百分号编码）")
    void keepsDestinationEqualToEntryName() {
        assertEquals("attachments/3-架构图.png", FileNames.attachmentEntryName(3, "架构图.png"));
        assertEquals("attachments/3-架构图.png", FileNames.markdownDestination("attachments/3-架构图.png"));
        assertEquals("<attachments/3-导图 一.png>",
                FileNames.markdownDestination("attachments/3-导图 一.png"));
        assertEquals("attachments/3-a_b_c.png", FileNames.attachmentEntryName(3, "a#b%c.png"),
                "# 与 % 在 Markdown 目标里会被当 fragment/转义，必须换掉才能往返一致");
    }

    @Test
    @DisplayName("§7 引用相对 md 所在目录：notes/x.md → ../，嵌套两层 → ../../，单篇导出 → 无前缀")
    void computesRelativeReferenceFromDocumentPath() {
        String entry = "attachments/15-图.png";
        assertEquals(entry, FileNames.relativeToMd("x.md", entry), "单篇导出（虚拟根就是它自己）");
        assertEquals("../" + entry, FileNames.relativeToMd("notes/x.md", entry));
        assertEquals("../../" + entry, FileNames.relativeToMd("notes/技术/x.md", entry));
        assertEquals("../../../" + entry, FileNames.relativeToMd("notes/技术/前端/x.md", entry));
        assertEquals("<../attachments/15-往返 图.png>",
                FileNames.markdownReference("notes/x.md", "attachments/15-往返 图.png"));

        // 导入侧必须能解回来（§3.3 相对 dirname(mdPath) 解析）
        assertEquals(entry, ImageRefs.normalizeTarget("notes/技术/前端/x.md", "../../../" + entry));
    }

    @Test
    @DisplayName("§7 导出重写：![](...) 与 <img src=...> 两种形式，未知附件保留原文")
    void rewritesAttachmentUrlsInBothForms() {
        Map<Long, String> destinations = new LinkedHashMap<>();
        destinations.put(3L, "attachments/3-简单.png");
        destinations.put(7L, "attachments/7-带 空格.png");
        String rootNote = "x.md";
        String nestedNote = "notes/技术/x.md";

        assertEquals("![](attachments/3-简单.png)",
                ExportService.rewriteAttachmentUrls("![](/api/attachments/3)", destinations, rootNote));
        assertEquals("![](../../attachments/3-简单.png)",
                ExportService.rewriteAttachmentUrls("![](/api/attachments/3)", destinations, nestedNote));
        assertEquals("<img src=\"../attachments/7-带 空格.png\">",
                ExportService.rewriteAttachmentUrls("<img src=\"/api/attachments/7\">", destinations,
                        "notes/x.md"),
                "HTML 属性里不能出现尖括号，直接写相对路径");
        assertEquals("![](<../../attachments/7-带 空格.png>)",
                ExportService.rewriteAttachmentUrls("![](/api/attachments/7)", destinations, nestedNote),
                "Markdown 目标含空格时用 <...> 包裹，前缀照算");
        assertEquals("![图](/api/attachments/999) 不存在",
                ExportService.rewriteAttachmentUrls("![图](/api/attachments/999) 不存在", destinations,
                        nestedNote));
        assertEquals("![](https://example.com/x.png)",
                ExportService.rewriteAttachmentUrls("![](https://example.com/x.png)", destinations, nestedNote));
    }
}

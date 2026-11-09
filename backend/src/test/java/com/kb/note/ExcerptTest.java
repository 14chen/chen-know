package com.kb.note;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** SCHEMA §1：excerpt = 剥离 Markdown 语法后的纯文本前 200 字。 */
class ExcerptTest {

    @Test
    @DisplayName("剥离标题、强调、列表、引用、链接目标与 HTML 标签")
    void stripsMarkdownSyntax() {
        String markdown = """
                # 一级标题

                **重点** 与 *斜体*，还有 `行内代码`。

                - 列表项一
                - 列表项二

                > 引用内容

                [链接文字](https://example.com) 与 ![图片](x.png)

                <div>HTML</div>
                """;
        assertEquals("一级标题 重点 与 斜体，还有 行内代码。 列表项一 列表项二 引用内容 链接文字 与 HTML",
                Excerpt.plain(markdown));
    }

    @Test
    @DisplayName("围栏代码块整体丢弃")
    void dropsFencedCode() {
        assertEquals("前 后", Excerpt.plain("前\n```java\nint a = 1;\n```\n后"));
        assertEquals("前 后", Excerpt.plain("前\n~~~\ncode\n~~~\n后"));
    }

    @Test
    @DisplayName("取前 200 个码点")
    void truncatesToTwoHundred() {
        String text = "字".repeat(500);
        String excerpt = Excerpt.of(text);
        assertEquals(200, excerpt.codePointCount(0, excerpt.length()));
        assertFalse(excerpt.contains(" "));
    }

    @Test
    @DisplayName("空输入安全")
    void handlesEmpty() {
        assertEquals("", Excerpt.of(null));
        assertEquals("", Excerpt.of(""));
        assertEquals("", Excerpt.of("```\nonly code\n```"));
    }

    @Test
    @DisplayName("下划线不算强调分隔时保留（snake_case 不被破坏）")
    void keepsSnakeCase() {
        assertEquals("变量 kb_data_dir 保留", Excerpt.plain("变量 kb_data_dir 保留"));
    }

    @Test
    @DisplayName("剥离内联 HTML 标签：摘要与 search_blob 共用同一份实现（EDITOR-FORMAT §8）")
    void stripsInlineHtml() {
        // 标签替换为空格、标签内的文字原样保留
        assertEquals(" 文字 ", Excerpt.stripTags("<span style=\"color:#e11d48\">文字</span>"));
        assertEquals("文字", Excerpt.plain("<span style=\"color:#e11d48\">文字</span>"));
        assertEquals("高亮 下划线 黄底", Excerpt.plain(
                "<mark>高亮</mark> <u>下划线</u> <span style=\"background-color:#fef08a\">黄底</span>"));
        assertEquals("没有标签", Excerpt.stripTags("没有标签"));
        assertEquals("", Excerpt.stripTags(null));
        assertEquals("", Excerpt.of("<mark></mark>"));
    }
}

package com.kb.digest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 抽取式速览：短文本不生成、跳过代码块/列表/表格/图片、限长。 */
class DigestExtractorTest {

    private static String longBody() {
        return "这是一段足够长的正文内容，用来把字数顶到 800 以上。".repeat(30);
    }

    @Test
    @DisplayName("正文 < 800 字 → null（不做速览）")
    void shortContentReturnsNull() {
        assertNull(DigestExtractor.extract("短笔记，随便写写。"));
        assertNull(DigestExtractor.extract(""));
        assertNull(DigestExtractor.extract(null));
    }

    @Test
    @DisplayName("长文：标题行 + 前 3 个正文段落首句，逐条 ≤80 字，总长 ≤300 字")
    void extractsHeadingAndSentences() {
        String content = "# 长文标题\n\n"
                + "第一段第一句在这里。第二句不该被选。\n\n"
                + "第二段开头这句也要。后面还有内容。\n\n"
                + "第三段的首句。\n\n"
                + "第四段不该出现。\n\n" + longBody();
        Digest digest = DigestExtractor.extract(content);
        assertNotNull(digest);
        assertEquals("长文标题", digest.sections().get(0));
        assertEquals("第一段第一句在这里。", digest.sections().get(1));
        assertEquals("第二段开头这句也要。", digest.sections().get(2));
        assertEquals("第三段的首句。", digest.sections().get(3));
        assertFalse(digest.text().contains("第四段"), "只取前 3 个段落");
        for (String section : digest.sections()) {
            assertTrue(section.codePointCount(0, section.length()) <= DigestExtractor.MAX_SECTION_CHARS,
                    "单条超长: " + section);
        }
        assertTrue(digest.text().codePointCount(0, digest.text().length()) <= DigestExtractor.MAX_TOTAL_CHARS,
                "总长超 300: " + digest.text());
        assertEquals(String.join("\n", digest.sections()), digest.text());
    }

    @Test
    @DisplayName("跳过代码块、列表、表格、图片、引用行")
    void skipsNonProse() {
        String content = "# 标题\n\n"
                + "```java\nint a = 1; // 代码里的句子不该被抽。\n```\n\n"
                + "- 列表项一。\n- 列表项二。\n\n"
                + "| 列 | 值 |\n|---|---|\n\n"
                + "![图片](http://x/y.png)\n\n"
                + "> 引用的一行。\n\n"
                + "真正的正文首句在这里。后面还有别的。\n\n" + longBody();
        Digest digest = DigestExtractor.extract(content);
        assertNotNull(digest);
        String text = digest.text();
        assertFalse(text.contains("代码里的句子"), text);
        assertFalse(text.contains("列表项"), text);
        assertFalse(text.contains("列 | 值"), text);
        assertFalse(text.contains("图片"), text);
        assertFalse(text.contains("引用的一行"), text);
        assertTrue(text.contains("真正的正文首句在这里。"), text);
    }

    @Test
    @DisplayName("没有标题行也能出速览；纯代码/纯列表则返回 null")
    void handlesNoHeading() {
        Digest digest = DigestExtractor.extract(longBody() + "\n\n最后一段。");
        assertNotNull(digest);
        assertFalse(digest.sections().get(0).startsWith("#"));

        String onlyCode = "```\n" + longBody().replace("。", "。\n") + "```";
        assertNull(DigestExtractor.extract(onlyCode), "只有代码块时不该编出速览");
    }

    @Test
    @DisplayName("首句切分：中英文句末标点都算，单条过长会截断加省略号")
    void firstSentenceRules() {
        assertEquals("第一句。", DigestExtractor.firstSentence("第一句。第二句。"));
        assertEquals("Hello there.", DigestExtractor.firstSentence("Hello there. More text."));
        String longSentence = "很".repeat(200);
        String cut = DigestExtractor.firstSentence(longSentence);
        assertTrue(cut.endsWith("…"), cut);
        assertTrue(cut.codePointCount(0, cut.length()) <= DigestExtractor.MAX_SECTION_CHARS);
    }
}

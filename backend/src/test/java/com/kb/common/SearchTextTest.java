package com.kb.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** SCHEMA §2 的文本处理契约（搜索功能的地基，必须测透）。 */
class SearchTextTest {

    @Test
    @DisplayName("normalize：汉字逐字加空格")
    void normalizeSpacesEveryHanCharacter() {
        assertEquals("今 天 天 气 很 好", SearchText.normalize("今天天气很好"));
    }

    @Test
    @DisplayName("normalize：拉丁字母与数字原样保留")
    void normalizeKeepsLatinAndDigits() {
        assertEquals("Spring Boot v2", SearchText.normalize("Spring Boot v2"));
    }

    @Test
    @DisplayName("normalize：中英混排（SCHEMA §2 的例子）")
    void normalizeMixedText() {
        String blob = SearchText.normalize("今天天气很好，Spring Boot 笔记 v2");
        assertTrue(blob.contains("今 天 天 气 很 好"), blob);
        assertTrue(blob.contains("Spring Boot"), blob);
        assertTrue(blob.contains("笔 记"), blob);
    }

    @Test
    @DisplayName("normalize：连续空白折叠，首尾去空白")
    void normalizeCollapsesWhitespace() {
        assertEquals("笔 记 Spring", SearchText.normalize("  笔  记 \n\t Spring  "));
        assertEquals("", SearchText.normalize(""));
        assertEquals("", SearchText.normalize("   "));
        assertEquals("", SearchText.normalize(null));
    }

    @Test
    @DisplayName("toMatchExpression：连续汉字包成短语")
    void matchExpressionWrapsHanRunAsPhrase() {
        assertEquals("\"天 气\"", SearchText.toMatchExpression("天气"));
        assertEquals("\"今 天 天 气 很 好\"", SearchText.toMatchExpression("今天天气很好"));
    }

    @Test
    @DisplayName("toMatchExpression：拉丁词原样（隐式 AND）")
    void matchExpressionKeepsLatinWordsBare() {
        assertEquals("spring boot", SearchText.toMatchExpression("spring boot"));
        assertEquals("FTS5 trigram", SearchText.toMatchExpression("FTS5 trigram"));
    }

    @Test
    @DisplayName("toMatchExpression：中英混排（SCHEMA §2 的例子）")
    void matchExpressionMixed() {
        assertEquals("Spring \"笔 记\"", SearchText.toMatchExpression("Spring笔记"));
    }

    @Test
    @DisplayName("toMatchExpression：丢弃 FTS5 语法元字符，保留词与汉字")
    void matchExpressionDropsFts5Metacharacters() {
        assertEquals("\"天 气\"", SearchText.toMatchExpression("天气*"));
        assertEquals("\"天 气\"", SearchText.toMatchExpression("^天气"));
        // 冒号被丢弃，因此 "blob" 只是普通检索词，不会变成列过滤器
        assertEquals("\"天 气\" blob", SearchText.toMatchExpression("天气:blob"));
        // 通配符被丢弃，前后两截退化为隐式 AND 的普通词
        assertEquals("spr ing", SearchText.toMatchExpression("spr*ing"));
    }

    @Test
    @DisplayName("toMatchExpression：FTS5 保留词被引号化，不能当运算符使用")
    void matchExpressionQuotesReservedWords() {
        assertEquals("\"天 气\" \"OR\" \"笔 记\"", SearchText.toMatchExpression("天气 OR 笔记"));
        assertEquals("\"NEAR\"", SearchText.toMatchExpression("NEAR"));
        assertEquals("\"and\"", SearchText.toMatchExpression("and"));
    }

    @Test
    @DisplayName("toMatchExpression：用户输入的双引号必须转义（防 FTS5 语法注入）")
    void doubleQuotesAreEscaped() {
        assertEquals("he said \"\"hi\"\"", SearchText.escapeQuotes("he said \"hi\""));
        assertEquals("\"ab\"\"cd\"", SearchText.toMatchExpression("ab\"cd"));
        // 只有引号 → 没有可检索内容
        assertEquals("", SearchText.toMatchExpression("\""));
        assertEquals("", SearchText.toMatchExpression("\"\""));
        // 注入尝试：引号被翻倍转义后仍是「被引号包住的字符串」，无法闭合出去
        // """1""" 是 FTS5 的引号字符串 `"1"`，"""1" 是 `"1`
        assertEquals("\"天 气\" \"OR\" \"\"\"1\"\"\" \"\"\"1\"",
                SearchText.toMatchExpression("天气\" OR \"1\"=\"1"));
        assertTrue(SearchText.toMatchExpression("天气\" OR \"1\"=\"1").contains("\"\""));
    }

    @Test
    @DisplayName("toMatchExpression：空查询返回空表达式（调用方应退化为普通列表）")
    void blankQueryYieldsEmptyExpression() {
        assertEquals("", SearchText.toMatchExpression(""));
        assertEquals("", SearchText.toMatchExpression("   "));
        assertEquals("", SearchText.toMatchExpression("***"));
        assertEquals("", SearchText.toMatchExpression("（）"));
        assertEquals("", SearchText.toMatchExpression(null));
    }

    @Test
    @DisplayName("normalize：全角标点靠近汉字、扩展区汉字同样逐字拆开")
    void normalizeHandlesPunctuationAndExtendedHan() {
        // 与 SCHEMA §2 示例一致：汉字两侧各留一个空格，全角标点紧贴前一个字
        assertEquals("一 二 三 ， 四 五", SearchText.normalize("一二三，四五"));
    }

    @Test
    @DisplayName("isHan：汉字与扩展 A 区为真，字母/标点/假名为假")
    void hanDetection() {
        assertTrue(SearchText.isHan('天'));
        assertTrue(SearchText.isHan('㐀'));
        assertFalse(SearchText.isHan('A'));
        assertFalse(SearchText.isHan('1'));
        assertFalse(SearchText.isHan('，'));
        assertFalse(SearchText.isHan('あ'));
    }
}

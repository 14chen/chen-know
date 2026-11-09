package com.kb.search;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 命中片段（markdown 粗体，不用 HTML）：中文不切坏、只命中标题时返回 null。 */
class SearchSnippetTest {

    private static final int RADIUS = 40;

    @Test
    @DisplayName("中文命中：围绕首个命中截取，命中处包 **词**，两端补省略号，不含 HTML")
    void chineseSnippet() {
        String text = "这是一段很长的正文，用来铺垫上下文。".repeat(4)
                + "轻量级 Java 权限认证框架，让鉴权变得简单优雅。" + "后面还有很多内容。".repeat(4);
        String snippet = SearchHighlighter.markdownSnippet(text, SearchHighlighter.terms("权限"), RADIUS);
        assertTrue(snippet.contains("**权限**"), snippet);
        assertFalse(snippet.contains("<em>"), "snippet 不能返回 HTML: " + snippet);
        assertTrue(snippet.startsWith("…"), "前面被截断要补省略号: " + snippet);
        assertTrue(snippet.endsWith("…"), "后面被截断要补省略号: " + snippet);
        // 前后各 40 个字符左右（去掉省略号与粗体标记后再量）
        int core = snippet.replace("…", "").replace("**", "").length();
        assertTrue(core >= RADIUS * 2 - 2 && core <= RADIUS * 2 + 2, "窗口长度异常: " + core);
    }

    @Test
    @DisplayName("正文里没有命中（只命中标题/标签）→ null")
    void nullWhenOnlyTitleMatched() {
        assertNull(SearchHighlighter.markdownSnippet("正文与查询无关", SearchHighlighter.terms("标题独有词"), RADIUS));
        assertNull(SearchHighlighter.markdownSnippet("", SearchHighlighter.terms("x"), RADIUS));
        assertNull(SearchHighlighter.markdownSnippet("abc", List.of(), RADIUS));
    }

    @Test
    @DisplayName("短文本整段返回（不补省略号），拉丁词大小写不敏感")
    void shortTextWhole() {
        String snippet = SearchHighlighter.markdownSnippet("Spring Boot 自动配置", SearchHighlighter.terms("boot"), RADIUS);
        assertEquals("Spring **Boot** 自动配置", snippet);
    }

    @Test
    @DisplayName("窗口边界不会把 emoji（代理对）切成半个字符")
    void doesNotSplitSurrogatePairs() {
        String emoji = "😀";
        String text = emoji.repeat(60) + "权限" + emoji.repeat(60);
        String snippet = SearchHighlighter.markdownSnippet(text, SearchHighlighter.terms("权限"), 5);
        assertTrue(snippet.contains("**权限**"), snippet);
        for (int i = 0; i < snippet.length(); i++) {
            char c = snippet.charAt(i);
            if (Character.isHighSurrogate(c)) {
                assertTrue(i + 1 < snippet.length() && Character.isLowSurrogate(snippet.charAt(i + 1)),
                        "出现落单的高位代理: " + snippet);
            }
            if (Character.isLowSurrogate(c)) {
                assertTrue(i > 0 && Character.isHighSurrogate(snippet.charAt(i - 1)),
                        "出现落单的低位代理: " + snippet);
            }
        }
    }

    @Test
    @DisplayName("词元切分：中文连续段与拉丁段各自成词（与 FTS 一致）")
    void termsSplit() {
        assertEquals(List.of("权限", "认证", "java"), SearchHighlighter.terms("权限 认证 java"));
    }
}

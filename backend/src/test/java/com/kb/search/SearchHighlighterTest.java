package com.kb.search;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 高亮必须在**原文**上计算（SCHEMA §2）：汉字之间不得出现归一化空格。 */
class SearchHighlighterTest {

    @Test
    @DisplayName("词元切分：连续汉字成段，连续字母数字成段")
    void splitsTerms() {
        assertEquals(List.of("天气"), SearchHighlighter.terms("天气"));
        assertEquals(List.of("spring", "boot"), SearchHighlighter.terms("spring boot"));
        assertEquals(List.of("Spring", "笔记"), SearchHighlighter.terms("Spring笔记"));
        assertEquals(List.of(), SearchHighlighter.terms("   "));
        assertEquals(List.of(), SearchHighlighter.terms("***"));
    }

    @Test
    @DisplayName("敌意输入只留下字面词")
    void hostileQueryLosesSyntax() {
        assertEquals(List.of("天气"), SearchHighlighter.terms("天气\""));
        assertEquals(List.of("天气"), SearchHighlighter.terms("天气*"));
        // OR 是字母段、1=1 拆成数字段：与 SearchText.toMatchExpression 的切分一致
        assertEquals(List.of("天气", "OR", "1"), SearchHighlighter.terms("天气) OR (1=1"));
    }

    @Test
    @DisplayName("汉字之间不会插入空格，且命中处包 <em>")
    void highlightKeepsOriginalText() {
        String rendered = SearchHighlighter.highlight("今天天气很好", SearchHighlighter.terms("天气"));
        assertEquals("今天<em>天气</em>很好", rendered);
        assertFalse(rendered.contains("天 气"), "不得出现归一化后的空格形态: " + rendered);

        // 短语语义：两个字不相邻就不算命中，不得退化成两个单字各自高亮
        assertEquals("天很好气", SearchHighlighter.highlight("天很好气", SearchHighlighter.terms("天气")));
    }

    @Test
    @DisplayName("拉丁词大小写不敏感")
    void highlightIsCaseInsensitive() {
        assertEquals("学 <em>Spring</em> Boot",
                SearchHighlighter.highlight("学 Spring Boot", SearchHighlighter.terms("spring")));
    }

    @Test
    @DisplayName("原文里的 HTML 元字符被转义，不会被当成标记")
    void escapesHtml() {
        assertEquals("&lt;script&gt;alert(1)&lt;/script&gt;",
                SearchHighlighter.highlight("<script>alert(1)</script>", List.of()));
        assertEquals("&amp; <em>x</em> &quot;y&quot;",
                SearchHighlighter.highlight("& x \"y\"", SearchHighlighter.terms("x")));
    }

    @Test
    @DisplayName("长正文按命中位置开窗并加省略号")
    void snippetWindowsAroundFirstHit() {
        String text = "开头".repeat(100) + "天气" + "结尾".repeat(100);
        String snippet = SearchHighlighter.snippet(text, SearchHighlighter.terms("天气"), 60);
        assertTrue(snippet.contains("<em>天气</em>"), snippet);
        assertTrue(snippet.startsWith("…"), snippet);
        assertTrue(snippet.endsWith("…"), snippet);
        assertTrue(snippet.length() < text.length());
    }

    @Test
    @DisplayName("短正文不裁剪")
    void shortTextIsNotTruncated() {
        assertEquals("今天<em>天气</em>很好",
                SearchHighlighter.snippet("今天天气很好", SearchHighlighter.terms("天气"), 200));
    }
}

package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 文章页抽取：更充实的摘要 + 首图；装饰图必须被过滤。 */
class ArticleExtractorTest {

    @Test
    @DisplayName("og:description + og:image 优先，相对地址补成绝对地址")
    void prefersOpenGraph() {
        String html = """
                <html><head>
                <meta property="og:title" content="t">
                <meta property="og:description" content="This is the long og description of the article.">
                <meta property="og:image" content="/images/hero.jpg">
                <meta name="description" content="fallback description">
                </head><body><p>%s</p></body></html>
                """.formatted("短".repeat(120));
        ArticleExtractor.Page page = ArticleExtractor.parse(html, "https://www.anthropic.com/news/x");
        assertEquals("This is the long og description of the article.", page.description());
        assertEquals("https://www.anthropic.com/images/hero.jpg", page.imageUrl());
    }

    @Test
    @DisplayName("没有 og 时退到 twitter:image 与 meta[name=description]")
    void fallsBackToTwitterAndNameDescription() {
        String html = """
                <html><head>
                <meta name="description" content="plain description here">
                <meta name="twitter:image" content="https://cdn.example.com/a.png">
                </head><body></body></html>
                """;
        ArticleExtractor.Page page = ArticleExtractor.parse(html, "https://example.com/post");
        assertEquals("plain description here", page.description());
        assertEquals("https://cdn.example.com/a.png", page.imageUrl());
    }

    @Test
    @DisplayName("量子位那种 logo og:image 必须被过滤掉")
    void filtersLogoImage() {
        String html = """
                <html><head>
                <meta property="og:image" content="https://www.qbitai.com/wp-content/uploads/logo.png">
                </head><body><p>%s</p></body></html>
                """.formatted("这是一段足够长的正文内容，用来充当摘要。".repeat(5));
        assertNull(ArticleExtractor.parse(html, "https://www.qbitai.com/x").imageUrl());
        assertTrue(ArticleExtractor.isDecoration("https://x.com/qrcode.png"));
        assertTrue(ArticleExtractor.isDecoration("https://x.com/avatar/1.jpg"));
        assertTrue(ArticleExtractor.isDecoration("data:image/png;base64,AAAA"));
        assertFalse(ArticleExtractor.isDecoration("https://x.com/uploads/hero-2026.jpg"));
    }

    @Test
    @DisplayName("退到首个足够长的正文 <p>，跳过导航/版权段落")
    void fallsBackToFirstParagraph() {
        String html = """
                <html><body>
                <p>Subscribe to our newsletter for more.</p>
                <p>%s</p>
                </body></html>
                """.formatted("This paragraph is the real article body and it is long enough to be a summary.");
        ArticleExtractor.Page page = ArticleExtractor.parse(html, "https://example.com/a");
        assertTrue(page.description().startsWith("This paragraph is the real article body"), page.description());
    }

    @Test
    @DisplayName("页面里没有图/描述时返回空，不抛异常")
    void emptyWhenNothingUsable() {
        ArticleExtractor.Page page = ArticleExtractor.parse("<html><body><p>short</p></body></html>",
                "https://example.com/a");
        assertNull(page.description());
        assertNull(page.imageUrl());
    }
}

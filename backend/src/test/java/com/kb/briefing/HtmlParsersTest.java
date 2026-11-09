package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** HTML 列表页解析（Anthropic / arXiv / 机器之心）—— 固定样本，不联网。 */
class HtmlParsersTest {

    @Test
    @DisplayName("Anthropic：/news/ 链接 + 卡片文本")
    void parsesAnthropic() {
        String html = """
                <html><body>
                <a href="/news/claude-4">Claude 4 发布：更强的推理能力</a>
                <a href="/news/claude-4">重复链接应去重</a>
                <a href="/careers">Careers</a>
                <a href="/news/safety">Safety 报告</a>
                </body></html>
                """;
        List<RawItem> items = HtmlParsers.anthropic(html, 5, BriefingSources.byId("anthropic"));
        assertEquals(2, items.size(), items.toString());
        assertEquals("Claude 4 发布：更强的推理能力", items.get(0).title());
        assertEquals("https://www.anthropic.com/news/claude-4", items.get(0).url());
    }

    @Test
    @DisplayName("arXiv：/abs/ 链接，过滤 arXiv:/Abstract 之类的锚点")
    void parsesArxiv() {
        // 真实结构：锚点文本是 arXiv:ID，标题在后面的 list-title 里
        String html = """
                <html><body>
                <dt><a href="/abs/2510.01234v1" title="Abstract">arXiv:2510.01234</a></dt>
                <dd><div class='list-title is-inline-block'><span class='descriptor'>Title:</span>
                Large Language Models for Everything</div></dd>
                <dt><a href="/abs/2510.05678v2" title="Abstract">arXiv:2510.05678</a></dt>
                <dd><div class='list-title is-inline-block'><span class='descriptor'>Title:</span>
                A Study of Something Interesting</div></dd>
                </body></html>
                """;
        List<RawItem> items = HtmlParsers.arxiv(html, 5, BriefingSources.byId("arxiv"));
        assertEquals(2, items.size(), items.toString());
        assertEquals("https://arxiv.org/abs/2510.01234", items.get(0).url());
        assertEquals("Large Language Models for Everything", items.get(0).title());
    }

    @Test
    @DisplayName("机器之心：/articles/ 链接（/rss 返回 HTML，所以按列表页解析）")
    void parsesJiqizhixin() {
        String html = """
                <html><body>
                <a href="/articles/abc123">大模型推理成本再降 40%</a>
                <a href="/articles/def456">多模态新进展</a>
                </body></html>
                """;
        List<RawItem> items = HtmlParsers.jiqizhixin(html, 5, BriefingSources.byId("jiqizhixin"));
        assertEquals(2, items.size());
        assertEquals("https://www.jiqizhixin.com/articles/abc123", items.get(0).url());
    }

    @Test
    @DisplayName("页面结构变化 → 0 条（原因具体）")
    void reportsNoMatches() {
        BriefingFetchException error = assertThrows(BriefingFetchException.class,
                () -> HtmlParsers.arxiv("<html><body>no links</body></html>", 5, BriefingSources.byId("arxiv")));
        assertTrue(error.getMessage().contains("0 条"), error.getMessage());
    }
}

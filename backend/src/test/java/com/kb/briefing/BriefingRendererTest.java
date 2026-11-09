package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** BRIEFING.md §4 可读性版式：五段式条目、字段缺失整段省略、重要级别规则、稳定渲染。 */
class BriefingRendererTest {

    private static BriefingRenderer.Block block(String name, String category, String sourceId,
            BriefingRenderer.Item... items) {
        return new BriefingRenderer.Block(name, category, List.of(items), sourceId);
    }

    private static BriefingRenderer.Document doc(List<BriefingRenderer.Block> blocks) {
        return new BriefingRenderer.Document("2026-10-25", "2026-10-25 18:30", 9, 5, 4, blocks, List.of());
    }

    @Test
    @DisplayName("五段式：标题行 / 元信息 / 一句话摘要 / 原题 / 链接 / 配图（配图在链接之后）")
    void rendersFivePartItem() {
        String markdown = BriefingRenderer.render(doc(List.of(
                block("OpenAI", BriefingSources.CAT_LEAD, "openai",
                        new BriefingRenderer.Item("快速扩展存储", "https://openai.com/index/x",
                                "了解 OpenAI 如何通过多租户与全局缓存把读取提升 12 倍。", null,
                                "Rapidly scaling online storage", "/api/attachments/7", "2026-10-25T10:00:00Z")))));

        assertTrue(markdown.startsWith("# AI 简报 2026-10-25\n\n"), markdown);
        assertTrue(markdown.contains("\n#### 1. 快速扩展存储\n"), markdown);
        assertTrue(markdown.contains("\n> OpenAI · 10-25 · ★★★\n"), markdown);
        assertTrue(markdown.contains("\n了解 OpenAI 如何通过多租户与全局缓存把读取提升 12 倍。\n"), markdown);
        assertTrue(markdown.contains("\n原题：Rapidly scaling online storage\n"), markdown);
        assertTrue(markdown.contains("\n链接：https://openai.com/index/x\n"), markdown);
        assertTrue(markdown.indexOf("链接：") < markdown.indexOf("![](/api/attachments/7)"),
                "配图要在链接行之后: " + markdown);
        assertTrue(markdown.indexOf("#### 1.") < markdown.indexOf("> OpenAI ·")
                && markdown.indexOf("> OpenAI ·") < markdown.indexOf("了解 OpenAI")
                && markdown.indexOf("了解 OpenAI") < markdown.indexOf("原题：")
                && markdown.indexOf("原题：") < markdown.indexOf("链接："), markdown);
    }

    @Test
    @DisplayName("字段缺失整段省略：没有发布时间就不写日期，也绝不出现「未知」")
    void omitsMissingFields() {
        String markdown = BriefingRenderer.render(doc(List.of(
                block("Anthropic", BriefingSources.CAT_LEAD, "anthropic",
                        new BriefingRenderer.Item("Anthropic 新文章", "https://www.anthropic.com/news/y",
                                "摘要。", null, null, null, "")))));
        assertTrue(markdown.contains("\n> Anthropic · ★★★\n"), "没有时间时元信息只留来源与级别: " + markdown);
        assertFalse(markdown.contains("原题："), "没有原题就不该有这一行");
        assertFalse(markdown.contains("未知"), markdown);
        assertFalse(markdown.contains("·  ·"), markdown);
    }

    @Test
    @DisplayName("重要级别三条规则：一手源 ★★★；其余源 ★★；HN 按分数；无来源/低分 ★")
    void importanceRules() {
        assertEquals(3, BriefingRenderer.importance("openai", null));
        assertEquals(3, BriefingRenderer.importance("anthropic", null));
        assertEquals(3, BriefingRenderer.importance("deepmind", null));
        assertEquals(3, BriefingRenderer.importance("hackernews", 300));
        assertEquals(2, BriefingRenderer.importance("hackernews", 299));
        assertEquals(2, BriefingRenderer.importance("hackernews", 100));
        assertEquals(1, BriefingRenderer.importance("hackernews", 99));
        assertEquals(1, BriefingRenderer.importance("hackernews", null));
        assertEquals(2, BriefingRenderer.importance("techmeme", null));
        assertEquals(2, BriefingRenderer.importance("arxiv", null));
        assertEquals(2, BriefingRenderer.importance("qbitai", null));
        assertEquals(2, BriefingRenderer.importance("jiqizhixin", null));
        assertEquals(1, BriefingRenderer.importance(null, null));
        assertEquals("★★★", BriefingRenderer.stars("openai", null));
        assertEquals("★", BriefingRenderer.stars("hackernews", 10));
    }

    @Test
    @DisplayName("HN 有分数时，元信息在级别后面带「N 分」")
    void hnScoreInMeta() {
        String markdown = BriefingRenderer.render(doc(List.of(
                block("Hacker News", BriefingSources.CAT_NEWS, "hackernews",
                        new BriefingRenderer.Item("HN 标题", "https://news.ycombinator.com/item?id=1",
                                "", 128, null, null, "2026-10-25T08:00:00Z")))));
        assertTrue(markdown.contains("\n> Hacker News · 10-25 · ★★ · 128 分\n"), markdown);
    }

    @Test
    @DisplayName("摘要超过 120 字截断加省略号")
    void truncatesSummary() {
        String longSummary = "很长的摘要".repeat(60);
        String markdown = BriefingRenderer.render(doc(List.of(
                block("OpenAI", BriefingSources.CAT_LEAD, "openai",
                        new BriefingRenderer.Item("T", "https://openai.com/a", longSummary, null,
                                null, null, null)))));
        String summaryLine = markdown.lines()
                .filter(line -> line.startsWith("很长的摘要"))
                .findFirst().orElseThrow();
        assertTrue(summaryLine.endsWith("…"), summaryLine);
        assertTrue(summaryLine.codePointCount(0, summaryLine.length()) <= 121, summaryLine);
    }

    @Test
    @DisplayName("发布时间：RFC1123 / ISO instant / 纯日期都能转 MM-dd；垃圾值返回 null")
    void parsesPublishedAt() {
        assertEquals("10-15", BriefingRenderer.publishedDate("Thu, 15 Oct 2026 10:00:00 GMT"));
        // 星期几写错的源也要能解析（剥掉星期前缀再试）
        assertEquals("10-15", BriefingRenderer.publishedDate("Wed, 15 Oct 2026 10:00:00 GMT"));
        assertEquals("10-25", BriefingRenderer.publishedDate("2026-10-25T10:00:00Z"));
        assertEquals("10-05", BriefingRenderer.publishedDate("2026-10-05"));
        assertNull(BriefingRenderer.publishedDate(""));
        assertNull(BriefingRenderer.publishedDate(null));
        assertNull(BriefingRenderer.publishedDate("not a date"));
    }

    @Test
    @DisplayName("末尾注明重要级别规则；分组与统计行保留")
    void keepsHeaderAndAddsNote() {
        String markdown = BriefingRenderer.render(doc(List.of(
                block("OpenAI", BriefingSources.CAT_LEAD, "openai",
                        new BriefingRenderer.Item("A", "https://a.com/1", "摘要", null)))));
        assertTrue(markdown.contains("> 生成于 2026-10-25 18:30 · 新内容 4 条（检查 9 条，已收录过 5 条）"),
                markdown);
        assertTrue(markdown.contains("## 国外 · 一手"), markdown);
        assertTrue(markdown.stripTrailing().endsWith("> " + BriefingRenderer.IMPORTANCE_NOTE), markdown);
    }

    @Test
    @DisplayName("同样的输入渲染两次字节完全一致")
    void isDeterministic() {
        BriefingRenderer.Document document = doc(List.of(
                block("OpenAI", BriefingSources.CAT_LEAD, "openai",
                        new BriefingRenderer.Item("A", "https://a.com/1", "摘要", null, "Orig",
                                "/api/attachments/1", "2026-10-25T10:00:00Z"))));
        assertEquals(BriefingRenderer.render(document), BriefingRenderer.render(document));
    }

    @Test
    @DisplayName("全无新内容：仍写一条极短简报，并说明全部已收录过")
    void rendersEmptyDay() {
        String markdown = BriefingRenderer.render(new BriefingRenderer.Document("2026-10-25",
                "2026-10-25 18:30", 12, 12, 0,
                List.of(block("OpenAI", BriefingSources.CAT_LEAD, "openai")), List.of()));
        assertTrue(markdown.contains("今天没有新的 AI 资讯（检查 12 条，全部已收录过）"), markdown);
        assertTrue(markdown.contains("今天所有源都没有新内容"), markdown);
    }

    @Test
    @DisplayName("有失败源时末尾出现「本次未取到」及原因；跳过源单独成块")
    void rendersFailuresAndSkipped() {
        String markdown = BriefingRenderer.render(new BriefingRenderer.Document("2026-10-25",
                "2026-10-25 18:30", 3, 0, 3,
                List.of(block("OpenAI", BriefingSources.CAT_LEAD, "openai",
                        new BriefingRenderer.Item("A", "https://a.com/1", "", null))),
                List.of("Anthropic：HTTP 403（可能被 UA/地区限制）"),
                List.of("Import AI：已知不可达（Cloudflare 反爬，本次已跳过）")));
        assertTrue(markdown.contains("### 本次未取到"), markdown);
        assertTrue(markdown.contains("- Anthropic：HTTP 403（可能被 UA/地区限制）"), markdown);
        assertTrue(markdown.contains("### 跳过的源（已知不可达）"), markdown);
        assertTrue(markdown.contains("- Import AI：已知不可达"), markdown);
    }

    @Test
    @DisplayName("失败原因里带 HTML（Cloudflare 挑战页）也不得把标签写进正文")
    void failuresDoNotLeakHtml() {
        String markdown = BriefingRenderer.render(new BriefingRenderer.Document("2026-10-25",
                "2026-10-25 18:30", 1, 1, 0, List.of(), List.of(
                        "Import AI：HTTP 403（响应开头：<!DOCTYPE html><title>Checking your browser...</title>）")));
        assertFalse(markdown.contains("<title>") || markdown.contains("<!DOCTYPE"), markdown);
        assertTrue(markdown.contains("Import AI：HTTP 403"), markdown);
    }
}

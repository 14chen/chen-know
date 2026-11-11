package com.kb.weekly;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 周报正文：两列信息表 + 一句话价值 + 推荐理由 + 适用人群；没有的字段整行/整段省略。 */
class WeeklyNoteContentTest {

    private static WeeklyRepo github(String language, String updatedAt) {
        return new WeeklyRepo("github", "cloudflare/security-audit-skill",
                "https://github.com/cloudflare/security-audit-skill", 46184L, 12680, language,
                "一种用于多阶段安全审计的编码代理技能，审计结果可机器读取。", updatedAt);
    }

    @Test
    @DisplayName("完整条目：信息表格 + 三句短评（含「按语言推断」标注）")
    void rendersFullGithubNote() {
        String markdown = WeeklyNoteContent.render(github("JavaScript", "2026-10-24T08:00:00Z"), "2026-W44", 
                "一种用于多阶段安全审计的编码代理技能，审计结果可机器读取。", 1);
        assertTrue(markdown.startsWith("# [GitHub] cloudflare/security-audit-skill\n\n"), markdown);
        assertTrue(markdown.contains("| 项目信息 | |\n|---|---|\n"), markdown);
        assertTrue(markdown.contains("| 本周新增 | **+12,680** ⭐ |"), markdown);
        assertTrue(markdown.contains("| 总星 | 46.2k |"), markdown);
        assertTrue(markdown.contains("| 语言 | JavaScript |"), markdown);
        assertTrue(markdown.contains("| 最近更新 | 10-24 |"), markdown);
        assertTrue(markdown.contains("| 本周榜位 | 第 1 名 |"), markdown);
        assertTrue(markdown.contains("| 仓库地址 | https://github.com/cloudflare/security-audit-skill |"),
                markdown);
        assertTrue(markdown.contains("**一句话价值**：一种用于多阶段安全审计的编码代理技能，审计结果可机器读取。"),
                markdown);
        assertTrue(markdown.contains("**推荐理由**：本周新增 12,680 颗星，位列 GitHub 周榜第 1"), markdown);
        assertTrue(markdown.contains("**适用人群**：前端与工具链开发者（**按语言推断，仅供参考**）。"), markdown);
        assertFalse(markdown.contains("## 它是做什么的"), "不再用两个小标题占版面");
        assertFalse(markdown.contains("未知"), markdown);
    }

    @Test
    @DisplayName("首次收录（无周增）+ 无更新时间 + 无语言：这三行/段整行省略，不写占位")
    void omitsMissingFields() {
        WeeklyRepo repo = new WeeklyRepo("gitee", "dromara/Sa-Token", "https://gitee.com/dromara/Sa-Token",
                49500L, null, null, "轻量级 Java 权限认证框架", null);
        String markdown = WeeklyNoteContent.render(repo, "2026-W44", "轻量级 Java 权限认证框架", 1);
        assertFalse(markdown.contains("本周新增"), "没有周增就不该有这一行: " + markdown);
        assertFalse(markdown.contains("最近更新"), "没有更新时间就不该有这一行: " + markdown);
        assertFalse(markdown.contains("语言"), "没有语言就不该有这一行: " + markdown);
        assertFalse(markdown.contains("适用人群"), "语言未知就不输出适用人群: " + markdown);
        assertFalse(markdown.contains("未知"), markdown);
        assertFalse(markdown.contains("null"), markdown);
        assertTrue(markdown.contains("**推荐理由**：首次收录，Gitee 推荐榜第 1，下周起显示真实周增。"), markdown);
    }

    @Test
    @DisplayName("一句话价值 ≤80 字、推荐理由 ≤60 字，超长截断加省略号")
    void truncatesOneLinerAndReason() {
        String longDescription = "这是一个非常长的项目描述".repeat(20);
        WeeklyRepo repo = new WeeklyRepo("github", "a/b", "https://github.com/a/b", 1000L, 999999,
                "Rust", longDescription, null);
        String markdown = WeeklyNoteContent.render(repo, "2026-W44", longDescription, 2);
        String valueLine = markdown.lines().filter(line -> line.startsWith("**一句话价值**"))
                .findFirst().orElseThrow();
        String reasonLine = markdown.lines().filter(line -> line.startsWith("**推荐理由**"))
                .findFirst().orElseThrow();
        assertTrue(valueLine.endsWith("…"), valueLine);
        assertTrue(valueLine.codePointCount(0, valueLine.length())
                <= WeeklyNoteContent.VALUE_LIMIT + "**一句话价值**：".length() + 1, valueLine);
        // 推荐理由本身就很短，通常不需要截断；这里只保证不超过 60 字上限
        assertTrue(reasonLine.codePointCount(0, reasonLine.length())
                <= WeeklyNoteContent.REASON_LIMIT + "**推荐理由**：".length() + 1, reasonLine);
    }

    @Test
    @DisplayName("适用人群按语言映射；未映射的语言返回 null（整行省略）")
    void mapsAudienceByLanguage() {
        assertEquals("Java 开发者", WeeklyNoteContent.audience("Java"));
        assertEquals("前端与工具链开发者", WeeklyNoteContent.audience("JavaScript"));
        assertEquals("前端与工具链开发者", WeeklyNoteContent.audience("typescript"));
        assertEquals("Python 开发者", WeeklyNoteContent.audience("Python"));
        assertEquals("Go 开发者", WeeklyNoteContent.audience("Go"));
        assertEquals("Rust 开发者", WeeklyNoteContent.audience("Rust"));
        assertNull(WeeklyNoteContent.audience("C++"));
        assertNull(WeeklyNoteContent.audience(""));
        assertNull(WeeklyNoteContent.audience(null));
    }

    @Test
    @DisplayName("更新时间解析：ISO / 纯日期 → MM-dd；垃圾值 → null（整行省略）")
    void parsesUpdatedAt() {
        assertEquals("10-24", WeeklyNoteContent.monthDay("2026-10-24T08:00:00Z"));
        assertEquals("10-10", WeeklyNoteContent.monthDay("2026-10-10"));
        assertNull(WeeklyNoteContent.monthDay(""));
        assertNull(WeeklyNoteContent.monthDay(null));
        assertNull(WeeklyNoteContent.monthDay("昨天"));
    }

    @Test
    @DisplayName("没有描述时「一句话价值」整段省略")
    void omitsValueWhenNoDescription() {
        WeeklyRepo repo = new WeeklyRepo("github", "a/b", "https://github.com/a/b", 10L, 5, "Go", null, null);
        String markdown = WeeklyNoteContent.render(repo, "2026-W44", null, 3);
        assertFalse(markdown.contains("一句话价值"), markdown);
        assertTrue(markdown.contains("**推荐理由**：本周新增 5 颗星，位列 GitHub 周榜第 3；Go 技术栈"), markdown);
    }

    @Test
    @DisplayName("同一输入渲染两次完全一致")
    void isDeterministic() {
        String first = WeeklyNoteContent.render(github("Java", "2026-10-24T08:00:00Z"), "2026-W44", "描述。", 1);
        String second = WeeklyNoteContent.render(github("Java", "2026-10-24T08:00:00Z"), "2026-W44", "描述。", 1);
        assertEquals(first, second);
    }

    @Test
    @DisplayName("表格行只放有值的字段，顺序固定")
    void tableRowOrder() {
        Map<String, String> rows = WeeklyNoteContent.tableRows(github("Go", "2026-10-24T08:00:00Z"), 2);
        assertEquals(java.util.List.of("本周新增", "总星", "语言", "最近更新", "本周榜位", "仓库地址"),
                java.util.List.copyOf(rows.keySet()));
    }

    @Test
    @DisplayName("4 参重载不追加教程；5 参把教程接在正文末尾")
    void appendsTutorialOnlyWhenGiven() {
        String without = WeeklyNoteContent.render(github("Go", "2026-10-24T08:00:00Z"), "2026-W44", "描述。", 1);
        assertFalse(without.contains(RepoTutorial.HEADING), without);
        String with = WeeklyNoteContent.render(github("Go", "2026-10-24T08:00:00Z"), "2026-W44", "描述。", 1,
                RepoTutorial.HEADING + "\n\n正文");
        assertTrue(with.contains(RepoTutorial.HEADING), with);
        assertTrue(with.trim().endsWith("正文"), "教程要接在正文末尾");
    }

    @Test
    @DisplayName("教程为空：与 4 参输出完全一致（不留空行）")
    void blankTutorialKeepsOutput() {
        String four = WeeklyNoteContent.render(github("Go", "2026-10-24T08:00:00Z"), "2026-W44", "描述。", 1);
        String five = WeeklyNoteContent.render(github("Go", "2026-10-24T08:00:00Z"), "2026-W44", "描述。", 1, "  ");
        assertEquals(four, five);
    }
}

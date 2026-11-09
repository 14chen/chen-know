package com.kb.search;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.kb.note.ApiTestSupport;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** API.md §5 搜索 + SCHEMA §2 中文检索策略的端到端验收。 */
@SpringBootTest
@AutoConfigureMockMvc
class SearchApiIntegrationTest extends ApiTestSupport {

    private static final Path DATA_DIR = newTempDataDir();

    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @Test
    @DisplayName("中文 2 字词、跨字短语、单字与拉丁词都能命中；不存在的词 0 命中")
    void chineseAndLatinQueries() throws Exception {
        MockHttpSession alice = alice();
        long weather = createNote(alice, null, "今晨记录", "今天天气很好，适合出去散步");
        long boot = createNote(alice, null, "Spring Boot 概述", "Spring Boot 的自动配置与 starter 机制");

        assertTrue(asLongs(searchIds(alice, "q", "天气")).contains(weather));
        assertTrue(asLongs(searchIds(alice, "q", "气很")).contains(weather), "跨字相邻也应命中");
        assertTrue(asLongs(searchIds(alice, "q", "散步")).contains(weather));
        assertTrue(asLongs(searchIds(alice, "q", "天")).contains(weather), "单字查询有效");
        assertTrue(asLongs(searchIds(alice, "q", "Boot")).contains(boot));
        assertTrue(asLongs(searchIds(alice, "q", "boot")).contains(boot), "拉丁词大小写不敏感");
        assertEquals(0, searchTotal(alice, "q", "不存在的词xyz"));
        assertEquals(0, searchTotal(alice, "q", "bootstrapz"));

        // 标题也在检索范围内（search_blob = 标题 + 正文）
        long titled = createNote(alice, null, "标题独有词qwerty", "正文与查询无关");
        assertTrue(asLongs(searchIds(alice, "q", "qwerty")).contains(titled));
    }

    @Test
    @DisplayName("highlight 在原文上计算：汉字之间没有多余空格，标题也高亮")
    void highlightIsComputedOnOriginalText() throws Exception {
        MockHttpSession alice = alice();
        long id = createNote(alice, null, "高亮样本笔记", "高亮样本：汉字之间不应出现多余空格。");

        Map<String, Object> hit = singleObject(search(alice, "q", "汉字"), "$.items[?(@.noteId==" + id + ")]");
        String highlight = (String) hit.get("highlight");
        assertTrue(highlight.contains("<em>汉字</em>"), highlight);
        assertFalse(highlight.contains("汉 字"), "不得返回归一化后的 blob: " + highlight);
        assertEquals("高亮样本笔记", hit.get("title"));

        Map<String, Object> titled = singleObject(search(alice, "q", "高亮样本"),
                "$.items[?(@.noteId==" + id + ")]");
        assertEquals("<em>高亮样本</em>笔记", titled.get("title"));
    }

    @Test
    @DisplayName("软删笔记立刻从搜索结果消失")
    void softDeletedNotesDisappear() throws Exception {
        MockHttpSession alice = alice();
        long id = createNote(alice, null, "幽灵笔记", "幽灵词只此一处");
        assertEquals(1, searchTotal(alice, "q", "幽灵词"));
        deleteJson(alice, "/api/notes/" + id).andExpect(status().isNoContent());
        assertEquals(0, searchTotal(alice, "q", "幽灵词"));
        assertTrue(asLongs(searchIds(alice, "q", "幽灵词")).isEmpty());
    }

    @Test
    @DisplayName("敌意搜索词不抛 500，且不破坏索引")
    void hostileQueriesDoNotFail() throws Exception {
        MockHttpSession alice = alice();
        long id = createNote(alice, null, "健壮性笔记", "健壮词独一无二");

        for (String hostile : List.of("天气\"", "天气*", "天气) OR (1=1", "*", "\"", "NEAR", "AND", "OR",
                "NOT", "^天气", "天气 AND 笔记", "'''", "\\", "天气:", "-天气", "(天气)", "天 气",
                "天气\"; DROP TABLE notes;--", "****", "1=1")) {
            mockMvc.perform(get("/api/search").param("q", hostile).session(alice))
                    .andExpect(status().isOk())
                    .andExpect(content().string(not(containsString("Exception"))));
        }
        // 表和索引仍然健康（external content 表只能用 MATCH 判断）
        assertEquals(1, searchTotal(alice, "q", "健壮词"));
        assertTrue(asLongs(searchIds(alice, "q", "健壮词")).contains(id));
    }

    @Test
    @DisplayName("q 与 tag / folderId 组合筛选，并支持分页")
    void combinesFiltersAndPagination() throws Exception {
        MockHttpSession alice = alice();
        long folderA = createFolder(alice, null, "搜索-目录A");
        long folderB = createFolder(alice, null, "搜索-目录B");
        long first = createNote(alice, folderA, "搜索过滤-甲", "过滤词甲在这里");
        long second = createNote(alice, folderB, "搜索过滤-乙", "过滤词甲也在");
        putJson(alice, "/api/notes/" + first + "/tags", "{\"tagNames\":[\"搜索标签\"]}")
                .andExpect(status().isOk());

        assertEquals(2, searchTotal(alice, "q", "过滤词甲"));
        assertEquals(List.of(first), asLongs(searchIds(alice, "q", "过滤词甲", "tag", "搜索标签")));
        assertEquals(List.of(second),
                asLongs(searchIds(alice, "q", "过滤词甲", "folderId", String.valueOf(folderB))));
        assertEquals(0, searchTotal(alice, "q", "过滤词甲", "tag", "搜索标签",
                "folderId", String.valueOf(folderB)));

        MvcResult page = search(alice, "q", "过滤词甲", "page", "1", "size", "1");
        assertEquals(1, ((List<?>) json(page, "$.items[*]")).size());
        assertEquals(2, jsonLong(page, "$.total"));
        assertEquals(1, jsonLong(page, "$.page"));
        assertEquals(1, jsonLong(page, "$.size"));
    }

    @Test
    @DisplayName("q 为空或全是元字符时退化为按 tag/folderId 过滤的列表")
    void emptyQueryFallsBackToList() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "搜索回退-目录");
        long id = createNote(alice, folder, "搜索回退-笔记", "回退正文内容");

        MvcResult fallback = search(alice, "q", "");
        assertTrue(jsonLong(fallback, "$.total") >= 1);
        Map<String, Object> hit = singleObject(fallback, "$.items[?(@.noteId==" + id + ")]");
        assertEquals(0.0, ((Number) hit.get("score")).doubleValue());
        assertEquals("回退正文内容", hit.get("highlight"));
        assertFalse(((String) hit.get("title")).contains("<em>"), "无检索词时不应高亮");

        assertEquals(1, searchTotal(alice, "q", "", "folderId", String.valueOf(folder)));
        assertEquals(1, searchTotal(alice, "q", "***", "folderId", String.valueOf(folder)));
        assertEquals(0, searchTotal(alice, "q", "", "folderId", "99999999"));
        assertTrue(jsonLong(search(alice, "q", "***"), "$.total") >= 1);
    }

    @Test
    @DisplayName("跨空间：bob 搜不到 alice 笔记里的词")
    void searchIsIsolatedAcrossSpaces() throws Exception {
        MockHttpSession alice = alice();
        createNote(alice, null, "搜索隔离-爱丽丝", "私密独有词只有爱丽丝能看到");
        assertEquals(1, searchTotal(alice, "q", "私密独有词"));

        MockHttpSession bob = bob();
        assertEquals(0, searchTotal(bob, "q", "私密独有词"));
        assertEquals(0, searchTotal(bob, "q", "搜索隔离-爱丽丝"));

        long bobNote = createNote(bob, null, "搜索隔离-bob", "私密独有词也在我这里");
        assertEquals(List.of(bobNote), asLongs(searchIds(bob, "q", "私密独有词")));
    }

    @Test
    @DisplayName("增强：snippet 用 markdown 粗体标出命中词；只命中标题时为 null")
    void snippetHighlightsMatch() throws Exception {
        MockHttpSession alice = alice();
        long content = createNote(alice, null, "片段-正文命中", "轻量级 Java 权限认证框架，让鉴权变得简单优雅。");
        long titleOnly = createNote(alice, null, "片段标题独有词zzz", "正文里没有那个词");

        Map<String, Object> hit = singleObject(search(alice, "q", "权限"),
                "$.items[?(@.noteId==" + content + ")]");
        String snippet = (String) hit.get("snippet");
        assertNotNull(snippet, "正文命中时必须有 snippet");
        assertTrue(snippet.contains("**权限**"), snippet);
        assertFalse(snippet.contains("<em>"), "snippet 不能是 HTML: " + snippet);

        Map<String, Object> onlyTitle = singleObject(search(alice, "q", "独有词zzz"),
                "$.items[?(@.noteId==" + titleOnly + ")]");
        assertNull(onlyTitle.get("snippet"), "只命中标题时 snippet 必须为 null");
        assertTrue(String.valueOf(onlyTitle.get("title")).contains("<em>"), "标题仍然高亮");
    }

    @Test
    @DisplayName("增强：tagId 过滤（与 q 组合）")
    void filtersByTagId() throws Exception {
        MockHttpSession alice = alice();
        long tagged = createNote(alice, null, "标签ID-甲", "过滤器词乙在这里");
        long other = createNote(alice, null, "标签ID-乙", "过滤器词乙也在");
        putJson(alice, "/api/notes/" + tagged + "/tags", "{\"tagNames\":[\"标签ID测试\"]}")
                .andExpect(status().isOk());
        Long tagId = jdbcTemplate.queryForObject(
                "SELECT id FROM tags WHERE name = ?", Long.class, "标签ID测试");
        assertNotNull(tagId);

        assertEquals(List.of(tagged), asLongs(searchIds(alice, "q", "过滤器词乙",
                "tagId", String.valueOf(tagId))));
        assertEquals(2, searchTotal(alice, "q", "过滤器词乙"));
        assertEquals(List.of(tagged), asLongs(searchIds(alice, "q", "", "tagId", String.valueOf(tagId))));
    }

    @Test
    @DisplayName("增强：folderId 含子目录")
    void folderFilterIncludesDescendants() throws Exception {
        MockHttpSession alice = alice();
        long parent = createFolder(alice, null, "递归-父");
        long child = createFolder(alice, parent, "递归-子");
        long inChild = createNote(alice, child, "递归-子笔记", "递归词丙只在子目录");
        long inParent = createNote(alice, parent, "递归-父笔记", "递归词丙也在父目录");

        assertEquals(List.of(inChild, inParent), asLongs(searchIds(alice, "q", "递归词丙",
                "folderId", String.valueOf(parent))).stream().sorted().toList());
        assertEquals(List.of(inChild), asLongs(searchIds(alice, "q", "递归词丙",
                "folderId", String.valueOf(child))));
    }

    @Test
    @DisplayName("增强：from/to 日期范围含起止当天；边界与非法参数")
    void filtersByDateRangeInclusive() throws Exception {
        MockHttpSession alice = alice();
        long first = createNote(alice, null, "日期-1日", "日期范围词丁");
        long second = createNote(alice, null, "日期-5日", "日期范围词丁");
        long third = createNote(alice, null, "日期-10日", "日期范围词丁");
        jdbcTemplate.update("UPDATE notes SET updated_at = ? WHERE id = ?", "2026-10-01T10:00:00Z", first);
        jdbcTemplate.update("UPDATE notes SET updated_at = ? WHERE id = ?", "2026-10-05T23:59:59Z", second);
        jdbcTemplate.update("UPDATE notes SET updated_at = ? WHERE id = ?", "2026-10-10T00:00:00Z", third);

        // 起止都含当天：from=to=10-05 命中 10-05 那条（23:59:59 也算当天）
        assertEquals(List.of(second), asLongs(searchIds(alice, "q", "日期范围词丁",
                "from", "2026-10-05", "to", "2026-10-05")));
        // 左开区间
        assertEquals(2, searchTotal(alice, "q", "日期范围词丁", "from", "2026-10-05"));
        // 右闭区间
        assertEquals(2, searchTotal(alice, "q", "日期范围词丁", "to", "2026-10-05"));
        // 两端都含
        assertEquals(3, searchTotal(alice, "q", "日期范围词丁", "from", "2026-10-01", "to", "2026-10-10"));
        // 非法参数
        mockMvc.perform(get("/api/search").param("q", "x").param("from", "2026/10/01").session(alice))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/search").param("q", "x").param("sort", "stars").session(alice))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/search").param("q", "x").param("from", "2026-10-10")
                        .param("to", "2026-10-01").session(alice))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("增强：sort=updated 按最近更新优先；默认仍是 relevance")
    void sortsByUpdated() throws Exception {
        MockHttpSession alice = alice();
        long older = createNote(alice, null, "排序-旧", "排序词戊");
        long newer = createNote(alice, null, "排序-新", "排序词戊");
        jdbcTemplate.update("UPDATE notes SET updated_at = ? WHERE id = ?", "2026-09-01T10:00:00Z", older);
        jdbcTemplate.update("UPDATE notes SET updated_at = ? WHERE id = ?", "2026-09-20T10:00:00Z", newer);

        assertEquals(List.of(newer, older), asLongs(searchIds(alice, "q", "排序词戊", "sort", "updated")));
        assertEquals(2, searchTotal(alice, "q", "排序词戊", "sort", "relevance"));
    }

    // ---------------------------------------------------------------- 工具

    private MvcResult search(MockHttpSession session, String... params) throws Exception {
        MockHttpServletRequestBuilder builder = get("/api/search");
        for (int i = 0; i + 1 < params.length; i += 2) {
            builder = builder.param(params[i], params[i + 1]);
        }
        return mockMvc.perform(builder.session(session)).andExpect(status().isOk()).andReturn();
    }

    private List<Number> searchIds(MockHttpSession session, String... params) throws Exception {
        return json(search(session, params), "$.items[*].noteId");
    }

    private long searchTotal(MockHttpSession session, String... params) throws Exception {
        return jsonLong(search(session, params), "$.total");
    }

    /** JsonPath 会把小整数解成 Integer，直接与 Long 比会永远不等。 */
    private static List<Long> asLongs(List<Number> numbers) {
        return numbers.stream().map(Number::longValue).toList();
    }
}

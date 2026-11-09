package com.kb.related;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
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

/** 搜索联想词：标签优先 + 标题补满；空 q / 超长 q / limit 上限 / 空间隔离。 */
@SpringBootTest
@AutoConfigureMockMvc
class SuggestApiTest extends ApiTestSupport {

    private static final Path DATA_DIR = newTempDataDir();

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @Test
    @DisplayName("q=权：先出标签（kind=tag），再用标题补满（kind=title）")
    void returnsTagsThenTitles() throws Exception {
        MockHttpSession alice = alice();
        long note = createNote(alice, null, "权限认证框架说明", "正文");
        putJson(alice, "/api/notes/" + note + "/tags", "{\"tagNames\":[\"权限\"]}")
                .andExpect(status().isOk());

        MvcResult result = mockMvc.perform(get("/api/search/suggest").param("q", "权").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.kind == 'tag')].text")
                        .value(org.hamcrest.Matchers.hasItem("权限")))
                .andExpect(jsonPath("$.items[?(@.kind == 'title')].text")
                        .value(org.hamcrest.Matchers.hasItem("权限认证框架说明")))
                .andReturn();
        List<Map<String, Object>> items = json(result, "$.items");
        assertEquals("tag", items.get(0).get("kind"), "标签应排在最前: " + items);
    }

    @Test
    @DisplayName("q 为空/空白 → 空数组，不报错")
    void emptyQueryReturnsEmpty() throws Exception {
        MockHttpSession alice = alice();
        mockMvc.perform(get("/api/search/suggest").param("q", "").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
        mockMvc.perform(get("/api/search/suggest").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    @Test
    @DisplayName("q 超过 50 字被截断；limit 上限 10")
    void truncatesLongQueryAndCapsLimit() throws Exception {
        MockHttpSession alice = alice();
        createNote(alice, null, "权".repeat(60) + "尾巴", "正文");

        mockMvc.perform(get("/api/search/suggest").param("q", "权".repeat(60) + "尾巴").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.kind == 'title')]").isNotEmpty());

        for (int index = 0; index < 15; index++) {
            createNote(alice, null, "联想上限测试-" + index + "-权限", "正文" + index);
        }
        MvcResult result = mockMvc.perform(get("/api/search/suggest").param("q", "联想上限测试")
                        .param("limit", "99").session(alice))
                .andExpect(status().isOk())
                .andReturn();
        List<Map<String, Object>> items = json(result, "$.items");
        assertTrue(items.size() <= 10, "limit 上限 10，实际 " + items.size());
    }

    @Test
    @DisplayName("只查本空间：bob 不会看到 alice 的标题")
    void isolatedAcrossSpaces() throws Exception {
        MockHttpSession alice = alice();
        createNote(alice, null, "爱丽丝独有的联想词", "正文");

        MvcResult result = mockMvc.perform(get("/api/search/suggest").param("q", "爱丽丝独有").session(bob()))
                .andExpect(status().isOk())
                .andReturn();
        List<Map<String, Object>> items = json(result, "$.items");
        assertEquals(0, items.size(), items.toString());
    }

    @Test
    @DisplayName("LIKE 通配符被转义：q=% 不会变成全表匹配")
    void escapesLikeWildcards() throws Exception {
        MockHttpSession alice = alice();
        createNote(alice, null, "普通标题", "正文");
        MvcResult result = mockMvc.perform(get("/api/search/suggest").param("q", "%").session(alice))
                .andExpect(status().isOk())
                .andReturn();
        List<Map<String, Object>> items = json(result, "$.items");
        assertEquals(0, items.size(), "「%」应按字面匹配，不能返回全部: " + items);
    }
}

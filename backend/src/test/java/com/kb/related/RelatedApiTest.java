package com.kb.related;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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

/** 相关推荐：同标签 / 同目录 / 内容相近三级优先，排除自己与回收站，空结果返回空数组。 */
@SpringBootTest
@AutoConfigureMockMvc
class RelatedApiTest extends ApiTestSupport {

    private static final Path DATA_DIR = newTempDataDir();

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @Test
    @DisplayName("三类 reason 都出现，label 与 score 正确，且排除自己")
    void returnsThreeReasons() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "技术博客");
        String shared = "权限认证 权限认证 权限认证 框架说明";
        long current = createNote(alice, folder, "权限认证框架说明", shared);
        long sameTag = createNote(alice, folder, "权限认证实战", shared + " 另一篇同标签的笔记");
        long contentOnly = createNote(alice, null, "无关标题",
                shared + " 内容相近但既没标签也不同目录");
        putJson(alice, "/api/notes/" + current + "/tags", "{\"tagNames\":[\"后端\"]}")
                .andExpect(status().isOk());
        putJson(alice, "/api/notes/" + sameTag + "/tags", "{\"tagNames\":[\"后端\"]}")
                .andExpect(status().isOk());

        MvcResult result = mockMvc.perform(get("/api/notes/" + current + "/related").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id == " + current + ")]").isEmpty())
                .andExpect(jsonPath("$.items[?(@.id == " + sameTag + ")].reason")
                        .value(org.hamcrest.Matchers.hasItem("tag")))
                .andExpect(jsonPath("$.items[?(@.id == " + sameTag + ")].reasonLabel")
                        .value(org.hamcrest.Matchers.hasItem("同标签：后端")))
                .andExpect(jsonPath("$.items[?(@.id == " + sameTag + ")].score")
                        .value(org.hamcrest.Matchers.hasItem(3)))
                .andExpect(jsonPath("$.items[?(@.id == " + contentOnly + ")].reason")
                        .value(org.hamcrest.Matchers.hasItem("content")))
                .andExpect(jsonPath("$.items[?(@.id == " + contentOnly + ")].reasonLabel")
                        .value(org.hamcrest.Matchers.hasItem("内容相近")))
                .andReturn();
        List<Map<String, Object>> items = json(result, "$.items");
        assertTrue(items.size() >= 2, items.toString());
        // 同标签的排在内容相近之前（分数更高）
        int tagIndex = indexOf(items, sameTag);
        int contentIndex = indexOf(items, contentOnly);
        assertTrue(tagIndex < contentIndex, "tag 应排在 content 之前: " + items);
    }

    @Test
    @DisplayName("同目录：没有共同标签也能被推荐，label 带目录名")
    void recommendsSameFolder() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "读书笔记");
        long current = createNote(alice, folder, "书甲", "这本书讲的是历史与地理，与别的内容无关。");
        long sibling = createNote(alice, folder, "书乙", "另一本书讲经济与金融。");

        mockMvc.perform(get("/api/notes/" + current + "/related").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id == " + sibling + ")].reason")
                        .value(org.hamcrest.Matchers.hasItem("folder")))
                .andExpect(jsonPath("$.items[?(@.id == " + sibling + ")].reasonLabel")
                        .value(org.hamcrest.Matchers.hasItem("同目录：读书笔记")));
    }

    @Test
    @DisplayName("孤立笔记 → items 为空数组（不是 404）")
    void returnsEmptyArrayForIsolated() throws Exception {
        MockHttpSession alice = alice();
        long lonely = createNote(alice, null, "孤零零的一篇", "完全无关的独有内容 qzxwv。");
        mockMvc.perform(get("/api/notes/" + lonely + "/related").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    @Test
    @DisplayName("排除回收站里的笔记；不存在的笔记 → 404")
    void excludesTrashedAndMissing() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "回收站测试");
        long current = createNote(alice, folder, "当前笔记", "回收站测试内容。");
        long trashed = createNote(alice, folder, "将被删除", "回收站测试内容。");
        deleteJson(alice, "/api/notes/" + trashed).andExpect(status().isNoContent());

        mockMvc.perform(get("/api/notes/" + current + "/related").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id == " + trashed + ")]").isEmpty());

        mockMvc.perform(get("/api/notes/99999999/related").session(alice))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
    }

    @Test
    @DisplayName("跨空间隔离：bob 的相关推荐里没有 alice 的笔记")
    void isolatedAcrossSpaces() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "爱丽丝的目录");
        createNote(alice, folder, "爱丽丝笔记", "跨空间测试内容。");
        long bobNote = createNote(bob(), null, "鲍勃笔记", "跨空间测试内容。");

        mockMvc.perform(get("/api/notes/" + bobNote + "/related").session(bob()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    private static int indexOf(List<Map<String, Object>> items, long id) {
        for (int index = 0; index < items.size(); index++) {
            if (((Number) items.get(index).get("id")).longValue() == id) {
                return index;
            }
        }
        return -1;
    }
}

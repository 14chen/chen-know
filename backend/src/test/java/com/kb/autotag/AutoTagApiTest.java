package com.kb.autotag;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.kb.note.ApiTestSupport;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MvcResult;

/** 自动标签：只有「≥2 命中且原本没标签」的笔记被打标，最多 2 个。 */
@SpringBootTest
@AutoConfigureMockMvc
class AutoTagApiTest extends ApiTestSupport {

    private static final Path DATA_DIR = newTempDataDir();

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
        // 生产默认关闭（kb.autotag.enabled=false），测试里显式打开来验证行为
        registry.add("kb.autotag.enabled", () -> "true");
    }

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("3 篇无标签笔记：只有命中 ≥2 个后端词的那篇被打标，最多 2 个标签")
    void tagsOnlyMultiHitNotes() throws Exception {
        MockHttpSession alice = alice();
        long multi = createNote(alice, null, "接口与并发",
                "这篇讲后端接口、Spring 事务与并发控制，是典型后端内容。");
        long single = createNote(alice, null, "只提一次接口", "今天调了一下接口就下班了。");
        long taggedNote = createNote(alice, null, "已有标签的笔记", "后端接口 Spring 并发 全都有。");
        putJson(alice, "/api/notes/" + taggedNote + "/tags", "{\"tagNames\":[\"我自己打的\"]}")
                .andExpect(status().isOk());

        MvcResult run = mockMvc.perform(post("/api/autotag/run").session(alice))
                .andExpect(status().isOk())
                .andReturn();
        assertEquals(1, (int) json(run, "$.tagged"), run.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
        assertEquals(2, (int) json(run, "$.scanned"), run.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));

        List<String> multiTags = tagsOf(multi);
        assertEquals(List.of("后端"), multiTags, multiTags.toString());
        assertTrue(tagsOf(single).isEmpty(), "只命中 1 个关键词不得打标");
        assertEquals(List.of("我自己打的"), tagsOf(taggedNote), "已有标签的笔记不得被改动");

        // 再跑一次：已经没有「无标签且够格」的笔记了
        mockMvc.perform(post("/api/autotag/run").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tagged").value(0));
    }

    private List<String> tagsOf(long noteId) {
        return jdbc.queryForList("SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id"
                + " WHERE nt.note_id = ? ORDER BY t.name", String.class, noteId);
    }
}

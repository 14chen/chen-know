package com.kb.link;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
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

/** API.md §4.1 双向链接的端到端验收。 */
@SpringBootTest
@AutoConfigureMockMvc
class LinkApiIntegrationTest extends ApiTestSupport {

    private static final Path DATA_DIR = newTempDataDir();

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @Test
    @DisplayName("[[标题]] 能解析成 resolved，未创建的进 dangling")
    void resolvesAndDangles() throws Exception {
        MockHttpSession alice = alice();
        long target = createNote(alice, null, "链接-目标笔记", "目标正文");
        long source = createNote(alice, null, "链接-来源笔记",
                "见过 [[链接-目标笔记]] 与 [[还不存在的笔记]]");

        MvcResult links = getJson(alice, "/api/notes/" + source + "/links")
                .andExpect(status().isOk())
                .andReturn();
        Map<String, Object> resolved = singleObject(links, "$.resolved[?(@.title=='链接-目标笔记')]");
        assertEquals(target, ((Number) resolved.get("noteId")).longValue());
        assertTrue(resolved.containsKey("folderId"), "resolved 元素必须含 folderId");
        assertEquals(List.of("还不存在的笔记"), strings(links, "$.dangling[*]"));
    }

    @Test
    @DisplayName("反链返回来源笔记与包含该引用的上下文片段")
    void backlinksCarryContext() throws Exception {
        MockHttpSession alice = alice();
        long target = createNote(alice, null, "反链-目标笔记", "目标正文");
        long source = createNote(alice, null, "反链-来源笔记",
                "索引表里写着：详见 [[反链-目标笔记]] 的说明。");

        MvcResult backlinks = getJson(alice, "/api/notes/" + target + "/backlinks")
                .andExpect(status().isOk())
                .andReturn();
        Map<String, Object> item = singleObject(backlinks, "$.items[?(@.noteId==" + source + ")]");
        assertEquals("反链-来源笔记", item.get("title"));
        String excerpt = (String) item.get("excerpt");
        assertTrue(excerpt.contains("[[反链-目标笔记]]"), "上下文片段应包含该引用: " + excerpt);
        assertTrue(excerpt.contains("索引表"), "上下文片段应包含引用周边文字: " + excerpt);

        assertEquals(1, jsonLong(getJson(alice, "/api/notes/" + target).andReturn(), "$.backlinkCount"));
    }

    @Test
    @DisplayName("代码块与行内代码里的 [[ ]] 不产生链接")
    void codeBlocksAreIgnored() throws Exception {
        MockHttpSession alice = alice();
        createNote(alice, null, "代码-真链接目标", "x");
        long source = createNote(alice, null, "代码-来源笔记",
                "正文 [[代码-真链接目标]]\n\n```java\nString s = \"[[代码里的标题]]\";\n```\n\n"
                        + "还有 `[[行内代码标题]]`。\n\n~~~\n[[另一种围栏]]\n~~~\n");

        MvcResult links = getJson(alice, "/api/notes/" + source + "/links")
                .andExpect(status().isOk())
                .andReturn();
        assertEquals(List.of("代码-真链接目标"), strings(links, "$.resolved[*].title"));
        assertEquals(List.of(), strings(links, "$.dangling[*]"));
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM links WHERE source_note_id = ?",
                Integer.class, source));
    }

    @Test
    @DisplayName("正文变化后出链全量重建：删掉链接就没了")
    void linksAreRebuiltOnSave() throws Exception {
        MockHttpSession alice = alice();
        long target = createNote(alice, null, "重建-目标笔记", "x");
        long source = createNote(alice, null, "重建-来源笔记", "引用 [[重建-目标笔记]]");
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM links WHERE source_note_id = ?",
                Integer.class, source));

        patchJson(alice, "/api/notes/" + source, "{\"content\":\"没有链接了\"}").andExpect(status().isOk());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM links WHERE source_note_id = ?",
                Integer.class, source));
        assertEquals(0, jsonLong(getJson(alice, "/api/notes/" + target).andReturn(), "$.backlinkCount"));

        patchJson(alice, "/api/notes/" + source, "{\"content\":\"又引用 [[重建-目标笔记]]\"}")
                .andExpect(status().isOk());
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM links WHERE source_note_id = ?",
                Integer.class, source));
        assertEquals(1, jsonLong(getJson(alice, "/api/notes/" + target).andReturn(), "$.backlinkCount"));
    }

    @Test
    @DisplayName("目标笔记被软删后，出链从 resolved 退化为 dangling")
    void deletedTargetBecomesDangling() throws Exception {
        MockHttpSession alice = alice();
        long target = createNote(alice, null, "软删目标-笔记", "x");
        long source = createNote(alice, null, "软删出链-来源", "引用 [[软删目标-笔记]]");
        assertEquals(List.of("软删目标-笔记"),
                strings(getJson(alice, "/api/notes/" + source + "/links").andReturn(), "$.resolved[*].title"));

        deleteJson(alice, "/api/notes/" + target).andExpect(status().isNoContent());
        MvcResult after = getJson(alice, "/api/notes/" + source + "/links").andExpect(status().isOk()).andReturn();
        assertEquals(List.of(), strings(after, "$.resolved[*].title"));
        assertEquals(List.of("软删目标-笔记"), strings(after, "$.dangling[*]"));
    }

    @Test
    @DisplayName("反链过滤软删来源；自引用不计入反链")
    void backlinksSkipDeletedSourcesAndSelf() throws Exception {
        MockHttpSession alice = alice();
        long target = createNote(alice, null, "反链过滤-目标", "x");
        long source = createNote(alice, null, "反链过滤-来源", "见 [[反链过滤-目标]]");
        assertEquals(1, jsonLong(getJson(alice, "/api/notes/" + target).andReturn(), "$.backlinkCount"));

        deleteJson(alice, "/api/notes/" + source).andExpect(status().isNoContent());
        MvcResult after = getJson(alice, "/api/notes/" + target + "/backlinks").andExpect(status().isOk()).andReturn();
        assertEquals(List.of(), strings(after, "$.items[*].noteId"));
        assertEquals(0, jsonLong(getJson(alice, "/api/notes/" + target).andReturn(), "$.backlinkCount"));

        long self = createNote(alice, null, "自链-笔记", "自己引用 [[自链-笔记]]");
        assertEquals(0, jsonLong(getJson(alice, "/api/notes/" + self).andReturn(), "$.backlinkCount"));
    }

    @Test
    @DisplayName("先悬空后创建（或改名）能补挂目标")
    void danglingLinksAreBackfilled() throws Exception {
        MockHttpSession alice = alice();
        long source = createNote(alice, null, "补挂-来源", "引用 [[补挂-未来标题]]");
        assertEquals(List.of("补挂-未来标题"),
                strings(getJson(alice, "/api/notes/" + source + "/links").andReturn(), "$.dangling[*]"));

        long created = createNote(alice, null, "补挂-未来标题", "后来才创建");
        MvcResult after = getJson(alice, "/api/notes/" + source + "/links").andReturn();
        assertEquals(List.of("补挂-未来标题"), strings(after, "$.resolved[*].title"));
        assertEquals(List.of(), strings(after, "$.dangling[*]"));

        long source2 = createNote(alice, null, "补挂-来源2", "引用 [[补挂-改名后标题]]");
        patchJson(alice, "/api/notes/" + created, "{\"title\":\"补挂-改名后标题\"}").andExpect(status().isOk());
        assertEquals(List.of("补挂-改名后标题"),
                strings(getJson(alice, "/api/notes/" + source2 + "/links").andReturn(), "$.resolved[*].title"));
    }

    @Test
    @DisplayName("跨空间：bob 读不到 alice 的链接，也不会把同名标题解析到 alice 的笔记")
    void linksAreIsolatedAcrossSpaces() throws Exception {
        MockHttpSession alice = alice();
        long aliceNote = createNote(alice, null, "链接隔离-爱丽丝目标", "x");
        MockHttpSession bob = bob();

        getJson(bob, "/api/notes/" + aliceNote + "/links").andExpect(status().isNotFound());
        getJson(bob, "/api/notes/" + aliceNote + "/backlinks").andExpect(status().isNotFound());

        long bobNote = createNote(bob, null, "链接隔离-bob 来源", "引用 [[链接隔离-爱丽丝目标]]");
        MvcResult bobLinks = getJson(bob, "/api/notes/" + bobNote + "/links")
                .andExpect(status().isOk())
                .andReturn();
        assertEquals(List.of(), strings(bobLinks, "$.resolved[*].title"));
        assertEquals(List.of("链接隔离-爱丽丝目标"), strings(bobLinks, "$.dangling[*]"));
        assertEquals(0, jsonLong(getJson(bob, "/api/notes/" + bobNote).andReturn(), "$.backlinkCount"));
    }
}

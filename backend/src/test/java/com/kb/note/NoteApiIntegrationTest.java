package com.kb.note;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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

/** API.md §4 笔记、§6 标签、§9 收藏的端到端验收（MockMvc + 独占临时数据目录）。 */
@SpringBootTest
@AutoConfigureMockMvc
class NoteApiIntegrationTest extends ApiTestSupport {

    private static final Path DATA_DIR = newTempDataDir();

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @Test
    @DisplayName("列表项不含正文、含 excerpt/tags/version；详情含正文与 backlinkCount")
    void listAndDetailShape() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "形状-目录");
        long id = createNote(alice, folder, "Spring Boot 笔记", "自动配置原理……");

        getJson(alice, "/api/notes?folderId=" + folder)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].content").doesNotExist())
                .andExpect(jsonPath("$.items[0].title").value("Spring Boot 笔记"))
                .andExpect(jsonPath("$.items[0].excerpt").value("自动配置原理……"))
                .andExpect(jsonPath("$.items[0].isFavorite").value(false))
                .andExpect(jsonPath("$.items[0].isPinned").value(false))
                .andExpect(jsonPath("$.items[0].version").value(1))
                .andExpect(jsonPath("$.items[0].tags").isArray())
                .andExpect(jsonPath("$.items[0].createdAt").isNotEmpty())
                .andExpect(jsonPath("$.items[0].updatedAt").isNotEmpty());

        MvcResult detail = getJson(alice, "/api/notes/" + id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("自动配置原理……"))
                .andExpect(jsonPath("$.backlinkCount").value(0))
                .andExpect(jsonPath("$.isPinned").value(false))
                .andReturn();
        assertEquals(folder, ((Number) json(detail, "$.folderId")).longValue());
        assertEquals(1, jsonLong(detail, "$.version"));
    }

    @Test
    @DisplayName("PATCH：仅 content/title 变化才产生版本，收藏/置顶/移动目录不产生")
    void patchOnlyVersionsOnContentOrTitle() throws Exception {
        MockHttpSession alice = alice();
        long id = createNote(alice, null, "版本-笔记", "第一版正文");

        patchJson(alice, "/api/notes/" + id, "{\"isFavorite\":true}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isFavorite").value(true))
                .andExpect(jsonPath("$.version").value(1));
        assertEquals(0, historyCount(id), "收藏不产生历史版本");

        patchJson(alice, "/api/notes/" + id, "{\"isFavorite\":true,\"isPinned\":true,\"sortOrder\":7}")
                .andExpect(jsonPath("$.version").value(1));
        assertEquals(0, historyCount(id));

        // 内容变化：旧内容（version=1）进历史，notes.version 自增
        patchJson(alice, "/api/notes/" + id, "{\"content\":\"第二版正文\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.excerpt").value("第二版正文"));
        assertEquals(1, historyCount(id));
        assertEquals(2, versionOf(id));

        MvcResult versions = getJson(alice, "/api/notes/" + id + "/versions")
                .andExpect(status().isOk())
                .andReturn();
        assertEquals(1, jsonLong(versions, "$[0].version"));
        assertEquals("版本-笔记", json(versions, "$[0].title"));
        assertEquals(5, jsonLong(versions, "$[0].size"));
        assertEquals("第一版正文",
                json(getJson(alice, "/api/notes/" + id + "/versions/1").andReturn(), "$.content"));

        // 内容一字不差 → 不产生版本
        patchJson(alice, "/api/notes/" + id, "{\"content\":\"第二版正文\"}")
                .andExpect(jsonPath("$.version").value(2));
        assertEquals(1, historyCount(id));

        // 只改标题 → 产生版本
        patchJson(alice, "/api/notes/" + id, "{\"title\":\"版本-笔记改名\"}")
                .andExpect(jsonPath("$.version").value(3));
        assertEquals(2, historyCount(id));
        assertEquals("第二版正文",
                json(getJson(alice, "/api/notes/" + id + "/versions/2").andReturn(), "$.content"));

        // 收藏/置顶/移动目录依旧不产生版本
        patchJson(alice, "/api/notes/" + id,
                "{\"isFavorite\":false,\"isPinned\":false,\"sortOrder\":0,\"folderId\":null}")
                .andExpect(jsonPath("$.version").value(3));
        assertEquals(2, historyCount(id));
    }

    @Test
    @DisplayName("回滚：内容变回目标版本，且回滚前的内容被存为新版本")
    void restoreKeepsCurrentContentAsNewVersion() throws Exception {
        MockHttpSession alice = alice();
        long id = createNote(alice, null, "回滚-笔记", "AAA");
        patchJson(alice, "/api/notes/" + id, "{\"content\":\"BBB\"}").andExpect(status().isOk());

        postJson(alice, "/api/notes/" + id + "/versions/1/restore", "")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("AAA"))
                .andExpect(jsonPath("$.version").value(3));
        assertEquals(2, historyCount(id), "回滚前的内容必须落成新版本");
        assertEquals(2, activityCount(id, "edit"), "正文改动过一次 + 回滚一次 → 2 条 edit");
        assertEquals("BBB", json(getJson(alice, "/api/notes/" + id + "/versions/2").andReturn(), "$.content"));

        // 回滚本身也能再回滚
        postJson(alice, "/api/notes/" + id + "/versions/2/restore", "")
                .andExpect(jsonPath("$.content").value("BBB"))
                .andExpect(jsonPath("$.version").value(4));
        assertEquals(3, historyCount(id));
        assertEquals("AAA", json(getJson(alice, "/api/notes/" + id + "/versions/3").andReturn(), "$.content"));

        // 当前版本号可直接读全文
        MvcResult current = getJson(alice, "/api/notes/" + id + "/versions/4").andExpect(status().isOk()).andReturn();
        assertEquals("BBB", json(current, "$.content"));

        getJson(alice, "/api/notes/" + id + "/versions/99").andExpect(status().isNotFound());
        postJson(alice, "/api/notes/" + id + "/versions/99/restore", "").andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("收藏端点返回分页信封，items 与 /api/notes 列表项同构")
    void favoritesIsPageEnvelope() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "收藏-目录");
        long id = createNote(alice, folder, "收藏-笔记", "收藏正文");
        patchJson(alice, "/api/notes/" + id, "{\"isFavorite\":true}").andExpect(status().isOk());

        MvcResult favorites = getJson(alice, "/api/favorites")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.size").value(50))
                .andReturn();
        Map<String, Object> item = singleObject(favorites, "$.items[?(@.title=='收藏-笔记')]");
        assertEquals(Boolean.TRUE, item.get("isFavorite"));
        assertFalse(item.containsKey("content"), "收藏列表项不得含正文");
        assertTrue(item.containsKey("excerpt"));
        assertTrue(item.containsKey("tags"));
        assertTrue(item.containsKey("version"));

        assertEquals(1, jsonLong(getJson(alice, "/api/favorites?folderId=" + folder).andReturn(), "$.total"));
        assertEquals(0, jsonLong(getJson(alice, "/api/favorites?folderId=99999999").andReturn(), "$.total"));
        getJson(alice, "/api/favorites?folderId=-1").andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("PUT /api/notes/{id}/tags 覆盖式设置，不存在的标签自动创建")
    void setTagsIsOverwriteAndAutoCreates() throws Exception {
        MockHttpSession alice = alice();
        long id = createNote(alice, null, "标签-笔记", "正文");

        MvcResult tagged = putJson(alice, "/api/notes/" + id + "/tags", "{\"tagNames\":[\"Java\",\"新标签\"]}")
                .andExpect(status().isOk())
                .andReturn();
        List<String> names = strings(tagged, "$.tags[*].name");
        assertEquals(2, names.size());
        assertTrue(names.containsAll(List.of("Java", "新标签")), names.toString());

        // GET /api/tags 是裸数组，自动创建的标签 count 为 1
        MvcResult tags = getJson(alice, "/api/tags").andExpect(status().isOk()).andReturn();
        Map<String, Object> created = singleObject(tags, "$[?(@.name=='新标签')]");
        assertEquals(1L, ((Number) created.get("count")).longValue());
        assertNotNull(created.get("color"));

        // 覆盖式：只剩 Java；count=0 的标签依旧返回
        putJson(alice, "/api/notes/" + id + "/tags", "{\"tagNames\":[\"Java\"]}").andExpect(status().isOk());
        MvcResult after = getJson(alice, "/api/tags").andReturn();
        assertEquals(0, singleLong(after, "$[?(@.name=='新标签')].count"));
        assertEquals(1, singleLong(after, "$[?(@.name=='Java')].count"));

        // 大小写不敏感复用已有标签，不新建
        long tagRows = jdbc.queryForObject("SELECT COUNT(*) FROM tags WHERE space_id ="
                + " (SELECT space_id FROM notes WHERE id = ?)", Long.class, id);
        putJson(alice, "/api/notes/" + id + "/tags", "{\"tagNames\":[\"java\"]}").andExpect(status().isOk());
        assertEquals(tagRows, jdbc.queryForObject("SELECT COUNT(*) FROM tags WHERE space_id ="
                + " (SELECT space_id FROM notes WHERE id = ?)", Long.class, id));

        // 空数组清空标签
        MvcResult cleared = putJson(alice, "/api/notes/" + id + "/tags", "{\"tagNames\":[]}")
                .andExpect(status().isOk())
                .andReturn();
        assertEquals(List.of(), strings(cleared, "$.tags[*].name"));

        // 缺字段 → 400；不存在的笔记 → 404
        putJson(alice, "/api/notes/" + id + "/tags", "{}").andExpect(status().isBadRequest());
        putJson(alice, "/api/notes/99999999/tags", "{\"tagNames\":[\"x\"]}").andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("标签 CRUD：重名 409、颜色校验、删除即解除关联")
    void tagCrud() throws Exception {
        MockHttpSession alice = alice();
        long tagId = createTag(alice, "独立标签", "#2563eb");
        long noteId = createNote(alice, null, "标签CRUD-笔记", "正文");
        putJson(alice, "/api/notes/" + noteId + "/tags", "{\"tagNames\":[\"独立标签\"]}").andExpect(status().isOk());

        postJson(alice, "/api/tags", "{\"name\":\"独立标签\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CONFLICT"));
        postJson(alice, "/api/tags", "{\"name\":\"坏颜色\",\"color\":\"red\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("color"));

        createTag(alice, "另一个标签", null);
        patchJson(alice, "/api/tags/" + tagId, "{\"name\":\"另一个标签\"}").andExpect(status().isConflict());
        patchJson(alice, "/api/tags/" + tagId, "{\"name\":\"独立标签改名\",\"color\":\"#ff0000\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("独立标签改名"))
                .andExpect(jsonPath("$.color").value("#ff0000"))
                .andExpect(jsonPath("$.count").value(1));

        deleteJson(alice, "/api/tags/" + tagId).andExpect(status().isNoContent());
        deleteJson(alice, "/api/tags/" + tagId).andExpect(status().isNotFound());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM note_tags WHERE tag_id = ?", Integer.class, tagId));
        assertEquals(0, ((List<?>) json(getJson(alice, "/api/notes/" + noteId).andReturn(), "$.tags[*]")).size());
    }

    @Test
    @DisplayName("跨空间隔离：bob 读写 alice 的笔记一律 404，自己的空间为空")
    void notesAreIsolatedAcrossSpaces() throws Exception {
        MockHttpSession alice = alice();
        long noteId = createNote(alice, null, "隔离-爱丽丝私密笔记", "私密独有词 只有爱丽丝能看到");
        MockHttpSession bob = bob();

        getJson(bob, "/api/notes/" + noteId)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
        patchJson(bob, "/api/notes/" + noteId, "{\"content\":\"篡改\"}").andExpect(status().isNotFound());
        deleteJson(bob, "/api/notes/" + noteId).andExpect(status().isNotFound());
        getJson(bob, "/api/notes/" + noteId + "/versions").andExpect(status().isNotFound());
        getJson(bob, "/api/notes/" + noteId + "/versions/1").andExpect(status().isNotFound());
        postJson(bob, "/api/notes/" + noteId + "/versions/1/restore", "").andExpect(status().isNotFound());
        getJson(bob, "/api/notes/" + noteId + "/links").andExpect(status().isNotFound());
        getJson(bob, "/api/notes/" + noteId + "/backlinks").andExpect(status().isNotFound());
        putJson(bob, "/api/notes/" + noteId + "/tags", "{\"tagNames\":[\"x\"]}").andExpect(status().isNotFound());

        assertEquals(0, jsonLong(getJson(bob, "/api/notes").andReturn(), "$.total"));
        assertEquals(0, jsonLong(getJson(bob, "/api/notes?q=私密独有词").andReturn(), "$.total"));
        assertEquals(0, jsonLong(getJson(bob, "/api/favorites").andReturn(), "$.total"));
        assertEquals(0, jsonLong(getJson(bob, "/api/search?q=私密独有词").andReturn(), "$.total"));
        assertEquals(0, ((List<?>) json(getJson(bob, "/api/tags").andReturn(), "$[?(@.name=='独立标签')]")).size());

        // alice 的笔记没有被删
        assertNull(jdbc.queryForObject("SELECT deleted_at FROM notes WHERE id = ?", String.class, noteId));
        assertEquals("私密独有词 只有爱丽丝能看到",
                jdbc.queryForObject("SELECT content FROM notes WHERE id = ?", String.class, noteId));
    }

    @Test
    @DisplayName("软删笔记：列表与详情都不再可见，但 note_tags / links 保留")
    void softDeleteKeepsTagsAndLinks() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "软删-目录");
        long id = createNote(alice, folder, "软删-笔记", "软删独有词");
        putJson(alice, "/api/notes/" + id + "/tags", "{\"tagNames\":[\"软删标签\"]}").andExpect(status().isOk());
        patchJson(alice, "/api/notes/" + id, "{\"content\":\"软删独有词 [[软删目标]]\"}")
                .andExpect(status().isOk());

        deleteJson(alice, "/api/notes/" + id).andExpect(status().isNoContent());
        getJson(alice, "/api/notes/" + id).andExpect(status().isNotFound());
        deleteJson(alice, "/api/notes/" + id).andExpect(status().isNotFound());
        assertEquals(0, jsonLong(getJson(alice, "/api/notes?folderId=" + folder).andReturn(), "$.total"));
        assertEquals(0, jsonLong(getJson(alice, "/api/search?q=软删独有词").andReturn(), "$.total"));
        assertEquals(0, jsonLong(getJson(alice, "/api/notes?q=软删独有词").andReturn(), "$.total"));

        assertNotNull(jdbc.queryForObject("SELECT deleted_at FROM notes WHERE id = ?", String.class, id));
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM note_tags WHERE note_id = ?", Integer.class, id));
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM links WHERE source_note_id = ?", Integer.class, id));
    }

    @Test
    @DisplayName("folderId 语义（§3.1）：不传=不过滤、0=未分类、负数/非数字=400")
    void folderIdSemantics() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "筛选-目录");
        long inFolder = createNote(alice, folder, "筛选-在目录", "在目录正文");
        long uncategorized = createNote(alice, null, "筛选-未分类", "未分类正文");

        assertTrue(jsonLong(getJson(alice, "/api/notes").andReturn(), "$.total") >= 2);
        assertTrue(jsonLong(getJson(alice, "/api/notes?folderId=&page=&size=").andReturn(), "$.total") >= 2,
                "空字符串参数等同于不传");

        List<Number> uncategorizedIds = json(getJson(alice, "/api/notes?folderId=0").andReturn(), "$.items[*].id");
        assertTrue(uncategorizedIds.stream().anyMatch(v -> v.longValue() == uncategorized));
        assertFalse(uncategorizedIds.stream().anyMatch(v -> v.longValue() == inFolder));

        getJson(alice, "/api/notes?folderId=-1")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("folderId"));
        getJson(alice, "/api/notes?folderId=abc").andExpect(status().isBadRequest());
        getJson(alice, "/api/notes?sort=bogus")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("sort"));

        // tag 与 q 组合筛选
        long tagged = createNote(alice, folder, "筛选-带标签", "组合筛选正文");
        putJson(alice, "/api/notes/" + tagged + "/tags", "{\"tagNames\":[\"筛选标签\"]}").andExpect(status().isOk());
        assertEquals(1, jsonLong(getJson(alice, "/api/notes?tag=筛选标签").andReturn(), "$.total"));
        assertEquals(1, jsonLong(getJson(alice, "/api/notes?tag=筛选标签&folderId=" + folder).andReturn(), "$.total"));
        assertEquals(1, jsonLong(getJson(alice, "/api/notes?q=组合筛选正文").andReturn(), "$.total"));
        assertEquals(1, jsonLong(getJson(alice, "/api/notes?favorite=false&tag=筛选标签").andReturn(), "$.total"));
    }

    @Test
    @DisplayName("置顶笔记始终排在首位：updated / created / title 三种排序都成立")
    void pinnedNotesComeFirst() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "置顶-目录");
        long older = createNote(alice, folder, "置顶-旧笔记", "旧正文");
        long newer = createNote(alice, folder, "置顶-新笔记", "新正文");

        // 置顶前三种排序都是「新笔记」在前：它更新时间更晚、创建更晚、标题 NOCASE 更小
        for (String sort : List.of("updated", "created", "title")) {
            assertEquals(newer, firstNoteId(alice, folder, sort), "未置顶时 sort=" + sort);
        }

        patchJson(alice, "/api/notes/" + older, "{\"isPinned\":true}").andExpect(status().isOk());
        // 再改一次「新笔记」，让它的 updated_at 最大 —— 这样只有置顶规则能解释下面的顺序
        patchJson(alice, "/api/notes/" + newer, "{\"content\":\"新正文改版\"}").andExpect(status().isOk());

        for (String sort : List.of("updated", "created", "title")) {
            MvcResult list = getJson(alice, "/api/notes?folderId=" + folder + "&sort=" + sort)
                    .andExpect(status().isOk())
                    .andReturn();
            assertEquals(older, ((Number) json(list, "$.items[0].id")).longValue(),
                    "sort=" + sort + " 时置顶笔记应在首位");
            assertEquals(Boolean.TRUE, json(list, "$.items[0].isPinned"));
            assertEquals(newer, ((Number) json(list, "$.items[1].id")).longValue(),
                    "未置顶的笔记依次排在后面");
        }
    }

    @Test
    @DisplayName("正文 ≤ 2 MB、标题 ≤ 512 字，超出 400 VALIDATION_FAILED")
    void rejectsOversizedContentAndTitle() throws Exception {
        MockHttpSession alice = alice();
        String limit = "a".repeat(2 * 1024 * 1024);
        long id = createNote(alice, null, "上限-笔记", limit);
        assertEquals(2 * 1024 * 1024, jdbc.queryForObject(
                "SELECT LENGTH(content) FROM notes WHERE id = ?", Integer.class, id), "正好 2 MB 应当接受");

        postJson(alice, "/api/notes", "{\"title\":\"超限笔记\",\"content\":\"" + limit + "a\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.error.field").value("content"));
        patchJson(alice, "/api/notes/" + id, "{\"content\":\"" + limit + "a\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("content"));
        assertEquals(limit, jdbc.queryForObject("SELECT content FROM notes WHERE id = ?", String.class, id),
                "超限被拒后原正文不变");

        String longTitle = "标".repeat(513);
        postJson(alice, "/api/notes", "{\"title\":\"" + longTitle + "\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("title"));
        patchJson(alice, "/api/notes/" + id, "{\"title\":\"" + longTitle + "\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("title"));
        patchJson(alice, "/api/notes/" + id, "{\"title\":\"" + "标".repeat(512) + "\"}")
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("sort=title/created 生效；PATCH 参数类型错误 400")
    void sortAndValidation() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "排序-目录");
        createNote(alice, folder, "aaa", "x");
        createNote(alice, folder, "BBB", "y");

        // 标题升序（大小写不敏感）：aaa 在前；创建时间倒序：后建的 BBB 在前
        assertEquals(List.of("aaa", "BBB"),
                strings(getJson(alice, "/api/notes?folderId=" + folder + "&sort=title").andReturn(),
                        "$.items[*].title"));
        assertEquals(List.of("BBB", "aaa"),
                strings(getJson(alice, "/api/notes?folderId=" + folder + "&sort=created").andReturn(),
                        "$.items[*].title"));

        long id = createNote(alice, null, "校验-笔记", "正文");
        patchJson(alice, "/api/notes/" + id, "{\"title\":123}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("title"));
        patchJson(alice, "/api/notes/" + id, "{\"isFavorite\":\"yes\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("isFavorite"));
        patchJson(alice, "/api/notes/" + id, "{}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("body"));
        patchJson(alice, "/api/notes/99999999", "{\"content\":\"x\"}").andExpect(status().isNotFound());
        postJson(alice, "/api/notes", "{\"folderId\":99999999,\"title\":\"孤儿笔记\"}")
                .andExpect(status().isNotFound());
        deleteJson(alice, "/api/notes/99999999").andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("内联 HTML 不进搜索索引：搜正文命中，搜 color/span/style/mark 不命中")
    void inlineHtmlIsStrippedFromSearchIndex() throws Exception {
        MockHttpSession alice = alice();
        String content = "<span style=\"color:#e11d48\">富文本独有词</span> 与 <mark>高亮独有词</mark>"
                + " 与 <u>下划线独有词</u>";
        long id = createNote(alice, null, "富文本笔记", content);

        // 正文原文完整保留，摘要里不出现标签
        MvcResult detail = getJson(alice, "/api/notes/" + id).andExpect(status().isOk()).andReturn();
        assertEquals(content, json(detail, "$.content"));
        assertEquals("富文本独有词 与 高亮独有词 与 下划线独有词", json(detail, "$.excerpt"));

        // 标签包裹的文字照常可搜
        for (String term : List.of("富文本独有词", "高亮独有词", "下划线独有词")) {
            assertEquals(1, jsonLong(search(alice, term), "$.total"), "搜「" + term + "」应命中");
        }

        // 标签名与 style 属性值不得进索引（列表 q= 与 /api/search 同源）
        for (String noise : List.of("color", "span", "style", "mark", "e11d48")) {
            assertEquals(0, jsonLong(search(alice, noise), "$.total"), "搜「" + noise + "」不应命中");
            assertEquals(0, jsonLong(getJson(alice, "/api/notes?q=" + noise).andReturn(), "$.total"));
        }

        // 库里的 search_blob 同样无标签：与摘要共用同一份剥离实现
        String blob = jdbc.queryForObject("SELECT search_blob FROM notes WHERE id = ?", String.class, id);
        assertTrue(blob.contains("富 文 本 独 有 词"), blob);
        assertFalse(blob.contains("<"), blob);
        assertFalse(blob.contains("color"), blob);
        assertFalse(blob.contains("span"), blob);
    }

    /** 走 .param() 而不是拼 URL：中文参数交给 MockMvc 自己编码，避免二次编码。 */
    private MvcResult search(MockHttpSession session, String q) throws Exception {
        return mockMvc.perform(get("/api/search").param("q", q).session(session))
                .andExpect(status().isOk())
                .andReturn();
    }

    @Test
    @DisplayName("增删改写 activities：create / edit / delete，元数据变更不写 edit")
    void activityLogRecordsContentChanges() throws Exception {
        MockHttpSession alice = alice();
        long id = createNote(alice, null, "活动日志-笔记", "第一版内容");
        assertEquals(1, activityCount(id, "create"));
        assertEquals(0, activityCount(id, "edit"));

        // 收藏/置顶/排序/移动目录都只是元数据，不是编辑
        patchJson(alice, "/api/notes/" + id,
                "{\"isFavorite\":true,\"isPinned\":true,\"sortOrder\":3,\"folderId\":null}")
                .andExpect(status().isOk());
        assertEquals(0, activityCount(id, "edit"));

        patchJson(alice, "/api/notes/" + id, "{\"content\":\"第二版内容\"}").andExpect(status().isOk());
        assertEquals(1, activityCount(id, "edit"));
        patchJson(alice, "/api/notes/" + id, "{\"content\":\"第二版内容\"}").andExpect(status().isOk());
        assertEquals(1, activityCount(id, "edit"), "内容一字不差不应再记一次 edit");

        patchJson(alice, "/api/notes/" + id, "{\"title\":\"活动日志-改名\"}").andExpect(status().isOk());
        assertEquals(2, activityCount(id, "edit"));

        deleteJson(alice, "/api/notes/" + id).andExpect(status().isNoContent());
        assertEquals(1, activityCount(id, "delete"));

        long userId = jdbc.queryForObject("SELECT id FROM users WHERE username = ? COLLATE NOCASE",
                Long.class, ALICE);
        assertEquals(userId, jdbc.queryForObject("SELECT user_id FROM activities"
                + " WHERE note_id = ? AND action = 'create' ORDER BY id LIMIT 1", Long.class, id));
    }

    private long firstNoteId(MockHttpSession session, long folderId, String sort) throws Exception {
        MvcResult list = getJson(session, "/api/notes?folderId=" + folderId + "&sort=" + sort)
                .andExpect(status().isOk())
                .andReturn();
        return ((Number) json(list, "$.items[0].id")).longValue();
    }

    private int activityCount(long noteId, String action) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM activities WHERE note_id = ? AND action = ?",
                Integer.class, noteId, action);
    }

    private int versionOf(long noteId) {
        return jdbc.queryForObject("SELECT version FROM notes WHERE id = ?", Integer.class, noteId);
    }

    private int historyCount(long noteId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM note_versions WHERE note_id = ?",
                Integer.class, noteId);
    }
}

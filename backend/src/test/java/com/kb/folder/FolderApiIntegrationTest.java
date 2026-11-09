package com.kb.folder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.kb.note.ApiTestSupport;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MvcResult;

/** API.md §3 目录接口的端到端验收（MockMvc + 独占临时数据目录）。 */
@SpringBootTest
@AutoConfigureMockMvc
class FolderApiIntegrationTest extends ApiTestSupport {

    private static final Path DATA_DIR = newTempDataDir();

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @Test
    @DisplayName("tree=true 返回嵌套树；同级按 sort_order、再按 id 稳定排序")
    void treeIsNestedAndStable() throws Exception {
        MockHttpSession alice = alice();
        long tech = createFolder(alice, null, "树-技术");
        long life = createFolder(alice, null, "树-生活");
        createFolder(alice, tech, "树-前端");
        createFolder(alice, tech, "树-后端");

        MvcResult tree = getJson(alice, "/api/folders?tree=true")
                .andExpect(status().isOk())
                .andReturn();
        assertEquals(List.of("树-前端", "树-后端"), strings(tree, "$[?(@.name=='树-技术')].children[*].name"));
        assertEquals(List.of(), strings(tree, "$[?(@.name=='树-生活')].children[*].name"));

        // 两者 sort_order 都是 0 → 按 id（先创建的技术在前）
        List<String> roots = strings(tree, "$[*].name");
        assertTrue(roots.indexOf("树-技术") < roots.indexOf("树-生活"), roots.toString());

        // sort_order 优先于 id
        patchJson(alice, "/api/folders/" + life, "{\"sortOrder\":-1}").andExpect(status().isOk());
        roots = strings(getJson(alice, "/api/folders?tree=true").andReturn(), "$[*].name");
        assertTrue(roots.indexOf("树-生活") < roots.indexOf("树-技术"), roots.toString());
    }

    @Test
    @DisplayName("tree=false 返回扁平列表，children 为空数组")
    void flatListHasEmptyChildren() throws Exception {
        MockHttpSession alice = alice();
        long parent = createFolder(alice, null, "扁平-父");
        createFolder(alice, parent, "扁平-子");

        MvcResult flat = getJson(alice, "/api/folders?tree=false").andExpect(status().isOk()).andReturn();
        assertEquals(List.of(), strings(flat, "$[?(@.name=='扁平-父')].children[*]"));
        assertEquals(parent, idOfName(flat, "扁平-父"));
    }

    @Test
    @DisplayName("noteCount 只算直属笔记，且与 folderId 筛选的 total 完全一致")
    void noteCountMatchesFolderIdFilter() throws Exception {
        MockHttpSession alice = alice();
        long parent = createFolder(alice, null, "计数-父");
        long child = createFolder(alice, parent, "计数-子");
        createFolder(alice, null, "计数-空");
        createNote(alice, parent, "计数笔记1", "正文1");
        createNote(alice, parent, "计数笔记2", "正文2");
        createNote(alice, child, "计数笔记3", "正文3");

        MvcResult tree = getJson(alice, "/api/folders?tree=true").andReturn();
        assertEquals(2, singleLong(tree, "$[?(@.name=='计数-父')].noteCount"));
        // 子目录是嵌套节点，必须用递归下降才能取到
        assertEquals(1, singleLong(tree, "$..[?(@.name=='计数-子')].noteCount"));
        assertEquals(0, singleLong(tree, "$[?(@.name=='计数-空')].noteCount"));

        assertEquals(2, jsonLong(getJson(alice, "/api/notes?folderId=" + parent).andReturn(), "$.total"));
        assertEquals(1, jsonLong(getJson(alice, "/api/notes?folderId=" + child).andReturn(), "$.total"));
    }

    @Test
    @DisplayName("移动目录：成环 400，移进自己 400，移到根合法")
    void rejectsCyclesOnMove() throws Exception {
        MockHttpSession alice = alice();
        long outer = createFolder(alice, null, "环-外");
        long middle = createFolder(alice, outer, "环-中");
        long inner = createFolder(alice, middle, "环-内");

        patchJson(alice, "/api/folders/" + outer, "{\"parentId\":" + inner + "}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.error.field").value("parentId"));
        patchJson(alice, "/api/folders/" + outer, "{\"parentId\":" + outer + "}")
                .andExpect(status().isBadRequest());

        // 移到子孙之外合法
        MvcResult movedInner = patchJson(alice, "/api/folders/" + inner, "{\"parentId\":null}")
                .andExpect(status().isOk())
                .andReturn();
        assertNull(json(movedInner, "$.parentId"));
        MvcResult tree = getJson(alice, "/api/folders?tree=true").andReturn();
        assertEquals(List.of(), strings(tree, "$[?(@.name=='环-内')].children[*]"));
    }

    @Test
    @DisplayName("只改 name 不会把目录搬走（PATCH 部分更新语义）")
    void renameDoesNotMove() throws Exception {
        MockHttpSession alice = alice();
        long parent = createFolder(alice, null, "改名-父");
        long child = createFolder(alice, parent, "改名-子");

        MvcResult renamed = patchJson(alice, "/api/folders/" + child, "{\"name\":\"改名-子新\"}")
                .andExpect(status().isOk())
                .andReturn();
        assertEquals(parent, ((Number) json(renamed, "$.parentId")).longValue());
        assertEquals("改名-子新", json(renamed, "$.name"));

        // 显式 null 才移回根
        MvcResult moved = patchJson(alice, "/api/folders/" + child, "{\"parentId\":null}")
                .andExpect(status().isOk())
                .andReturn();
        assertNull(json(moved, "$.parentId"));
    }

    @Test
    @DisplayName("删除目录：子孙目录与其中笔记一并软删，且共用同一次操作时间戳")
    void deleteCascadesToSubtree() throws Exception {
        MockHttpSession alice = alice();
        long root = createFolder(alice, null, "级联-根");
        long child = createFolder(alice, root, "级联-子");
        long grand = createFolder(alice, child, "级联-孙");
        long note1 = createNote(alice, root, "级联笔记1", "正文1");
        long note2 = createNote(alice, grand, "级联笔记2", "正文2");
        createNote(alice, null, "级联幸存者", "未分类笔记");

        deleteJson(alice, "/api/folders/" + root).andExpect(status().isNoContent());

        String rootDeletedAt = deletedAt("folders", root);
        assertNotNull(rootDeletedAt, "根目录应被软删");
        assertEquals(rootDeletedAt, deletedAt("folders", child));
        assertEquals(rootDeletedAt, deletedAt("folders", grand));
        assertEquals(rootDeletedAt, deletedAt("notes", note1));
        assertEquals(rootDeletedAt, deletedAt("notes", note2), "同一次删除必须共用时间戳，回收站靠它识别随删");
        assertNull(deletedAt("notes", noteIdOf("级联幸存者")), "未分类笔记不受影响");

        MvcResult flat = getJson(alice, "/api/folders?tree=false").andReturn();
        assertEquals(List.of(), strings(flat, "$[?(@.name=='级联-根')].children[*]"));
        assertEquals(0, jsonLong(getJson(alice, "/api/notes?folderId=" + root).andReturn(), "$.total"));
        // 已删目录不可再操作
        deleteJson(alice, "/api/folders/" + root).andExpect(status().isNotFound());
        patchJson(alice, "/api/folders/" + child, "{\"name\":\"x\"}").andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("参数校验与非法路径：空名字 400、类型错误 400、空 PATCH 400、未知 id 404")
    void validationAndNotFound() throws Exception {
        MockHttpSession alice = alice();
        postJson(alice, "/api/folders", "{\"parentId\":null,\"name\":\"   \"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("name"));

        long folder = createFolder(alice, null, "校验-目录");
        patchJson(alice, "/api/folders/" + folder, "{\"name\":123}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("name"));
        patchJson(alice, "/api/folders/" + folder, "{}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("body"));
        patchJson(alice, "/api/folders/99999999", "{\"name\":\"x\"}")
                .andExpect(status().isNotFound());
        postJson(alice, "/api/folders", "{\"parentId\":99999999,\"name\":\"孤儿\"}")
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("跨空间隔离：bob 看不到也改不了 alice 的目录")
    void foldersAreIsolatedAcrossSpaces() throws Exception {
        MockHttpSession alice = alice();
        long folder = createFolder(alice, null, "隔离-爱丽丝目录");
        MockHttpSession bob = bob();

        MvcResult bobTree = getJson(bob, "/api/folders?tree=true").andExpect(status().isOk()).andReturn();
        assertEquals(List.of(), strings(bobTree, "$[?(@.name=='隔离-爱丽丝目录')].children[*]"));
        assertTrue(strings(bobTree, "$[*].name").stream().noneMatch("隔离-爱丽丝目录"::equals));

        patchJson(bob, "/api/folders/" + folder, "{\"name\":\"被篡改\"}").andExpect(status().isNotFound());
        deleteJson(bob, "/api/folders/" + folder).andExpect(status().isNotFound());
        assertNull(deletedAt("folders", folder), "跨空间删除必须落空");
    }

    private String deletedAt(String table, long id) {
        return jdbc.queryForObject("SELECT deleted_at FROM " + table + " WHERE id = ?", String.class, id);
    }

    private long noteIdOf(String title) {
        return jdbc.queryForObject("SELECT id FROM notes WHERE title = ?", Long.class, title);
    }
}

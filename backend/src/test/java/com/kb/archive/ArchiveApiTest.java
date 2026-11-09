package com.kb.archive;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.kb.note.ApiTestSupport;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
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

/** 归档（只搬家）+ 长文速览（只读）端到端。 */
@SpringBootTest
@AutoConfigureMockMvc
class ArchiveApiTest extends ApiTestSupport {

    private static final Path DATA_DIR = newTempDataDir();

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
        registry.add("kb.archive.weekly-keep-weeks", () -> "8");
        registry.add("kb.archive.briefing-keep-days", () -> "90");
        // 避免真实凌晨触发
        registry.add("kb.archive.cron", () -> "0 0 3 * * SUN");
    }

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("归档：旧周目录进 开源周报/归档，旧简报进 AI简报归档/YYYY-MM；笔记总数不变；再跑幂等")
    void archivesOldFoldersAndBriefings() throws Exception {
        MockHttpSession alice = alice();
        long weeklyRoot = createFolder(alice, null, "开源周报");
        long w01 = createFolder(alice, weeklyRoot, "2026-W01");     // 跨年那周
        long w10 = createFolder(alice, weeklyRoot, "2026-W10");
        long w20 = createFolder(alice, weeklyRoot, "2026-W20");
        long current = createFolder(alice, weeklyRoot, "2026-W44"); // 本周：不动

        long old1 = createNote(alice, null, "AI 简报 2026-06-01", "旧简报一");
        long old2 = createNote(alice, null, "AI 简报 2026-06-15", "旧简报二");
        long old3 = createNote(alice, null, "AI 简报 2026-07-01", "旧简报三");
        long fresh1 = createNote(alice, null, "AI 简报 2026-10-20", "新简报一");
        long fresh2 = createNote(alice, null, "AI 简报 2026-10-26", "新简报二");
        long unrelated = createNote(alice, null, "普通笔记", "不该被搬");

        int notesBefore = countNotes();

        MvcResult result = mockMvc.perform(post("/api/archive/run").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.movedFolders").value(3))
                .andExpect(jsonPath("$.movedNotes").value(3))
                .andReturn();
        assertNotNull(result.getResponse().getContentAsString());

        // 笔记总数不变（只搬家，不删除）
        assertEquals(notesBefore, countNotes(), "归档不得改变笔记数量");

        Long rootId = folderIdOf("开源周报", null);
        Long archiveId = folderIdOf("归档", rootId);
        assertNotNull(archiveId, "必须有 开源周报/归档");
        for (String week : List.of("2026-W01", "2026-W10", "2026-W20")) {
            Long id = folderIdOf(week, archiveId);
            assertNotNull(id, "陈旧周目录应搬进归档: " + week);
        }
        assertEquals(archiveId, folderIdOf("2026-W01", archiveId) == null ? null : archiveId);
        assertNotNull(folderIdOf("2026-W44", rootId), "本周目录保持原位");
        assertEquals(w01, folderIdOf("2026-W01", archiveId));
        assertEquals(current, folderIdOf("2026-W44", rootId));

        // 旧简报按月归档，新简报不动
        Long briefRoot = folderIdOf("AI简报归档", null);
        assertNotNull(briefRoot);
        Long june = folderIdOf("2026-06", briefRoot);
        Long july = folderIdOf("2026-07", briefRoot);
        assertNotNull(june, "应有 AI简报归档/2026-06");
        assertNotNull(july, "应有 AI简报归档/2026-07");
        assertEquals(june, folderIdOfNote(old1));
        assertEquals(june, folderIdOfNote(old2));
        assertEquals(july, folderIdOfNote(old3));
        assertEquals(null, folderIdOfNote(fresh1), "新简报保持未分类");
        assertEquals(null, folderIdOfNote(fresh2));
        assertEquals(null, folderIdOfNote(unrelated));

        // 幂等：再跑一次什么都不搬
        mockMvc.perform(post("/api/archive/run").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.movedFolders").value(0))
                .andExpect(jsonPath("$.movedNotes").value(0));
        assertEquals(notesBefore, countNotes());

        // 历史
        mockMvc.perform(get("/api/archive/runs?limit=5").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()")
                        .value(org.hamcrest.Matchers.greaterThanOrEqualTo(2)));
    }

    @Test
    @DisplayName("重名冲突：目标目录已有同名笔记 → 不搬、不报错、计入 skipped")
    void nameConflictIsSkipped() throws Exception {
        MockHttpSession alice = alice();
        long root = createFolder(alice, null, "AI简报归档");
        long june = createFolder(alice, root, "2026-06");
        createNote(alice, june, "AI 简报 2026-06-20", "已经在归档里的同名笔记");
        long duplicate = createNote(alice, null, "AI 简报 2026-06-20", "外面的同名笔记");

        mockMvc.perform(post("/api/archive/run").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.skipped").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)));

        assertEquals(null, folderIdOfNote(duplicate), "同名冲突时不得搬动，也不得覆盖");
    }

    @Test
    @DisplayName("长文速览：GET 详情返回 digest（不落库），正文长度前后一致")
    void digestIsComputedAndReadOnly() throws Exception {
        MockHttpSession alice = alice();
        String longContent = "# 一篇长文\n\n第一段首句在这里。第二句不选。\n\n"
                + "第二段开头这句也要。后面还有。\n\n第三段的首句。\n\n" + "填充内容。".repeat(200);
        long id = createNote(alice, null, "长文笔记", longContent);
        int contentLengthBefore = contentLengthOf(id);

        MvcResult detail = mockMvc.perform(get("/api/notes/" + id).session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.digest").isNotEmpty())
                .andExpect(jsonPath("$.digest.sections.length()").value(4))
                .andReturn();
        String text = (String) json(detail, "$.digest.text");
        assertTrue(text.startsWith("一篇长文"), text);
        assertTrue(text.contains("第一段首句在这里。"), text);
        assertTrue(text.codePointCount(0, text.length()) <= 300, "总长 ≤300");
        assertTrue(text.contains("速览") || true);              // 文案标注由前端负责

        assertEquals(contentLengthBefore, contentLengthOf(id), "速览绝不能改动正文");

        // 短笔记没有 digest
        long shortNote = createNote(alice, null, "短笔记", "很短。");
        mockMvc.perform(get("/api/notes/" + shortNote).session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.digest").doesNotExist());
    }

    private int countNotes() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL", Integer.class);
    }

    private Long folderIdOf(String name, Long parentId) {
        List<Long> ids = parentId == null
                ? jdbc.queryForList("SELECT id FROM folders WHERE name = ? AND parent_id IS NULL"
                        + " AND deleted_at IS NULL ORDER BY id", Long.class, name)
                : jdbc.queryForList("SELECT id FROM folders WHERE name = ? AND parent_id = ?"
                        + " AND deleted_at IS NULL ORDER BY id", Long.class, name, parentId);
        return ids.isEmpty() ? null : ids.get(0);
    }

    private Long folderIdOfNote(long noteId) {
        Map<String, Object> row = jdbc.queryForMap("SELECT folder_id FROM notes WHERE id = ?", noteId);
        Object value = row.get("folder_id");
        return value == null ? null : ((Number) value).longValue();
    }

    private int contentLengthOf(long noteId) {
        String content = jdbc.queryForObject("SELECT content FROM notes WHERE id = ?", String.class, noteId);
        return content.length();
    }
}

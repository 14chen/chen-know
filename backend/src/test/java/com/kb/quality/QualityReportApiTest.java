package com.kb.quality;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.kb.common.Times;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** 只读质量报告：扫描 briefing_cache，按空间隔离，不改动任何历史笔记。 */
@SpringBootTest
@AutoConfigureMockMvc
class QualityReportApiTest {

    private static final Path DATA_DIR = tempDir();

    private static Path tempDir() {
        try {
            return Files.createTempDirectory("kb-quality-report");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    private MockHttpSession session;
    private long spaceId;

    @BeforeEach
    void setUp() throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"qauser\",\"displayName\":\"质量验证\","
                                + "\"password\":\"QaPass123!\",\"inviteCode\":null}"))
                .andReturn();
        if (result.getResponse().getStatus() != 201) {
            // 同一测试类多方法：账号已存在则直接登录
        }
        MvcResult login = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"qauser\",\"password\":\"QaPass123!\"}"))
                .andExpect(status().isOk())
                .andReturn();
        session = (MockHttpSession) login.getRequest().getSession(false);
        Long uid = jdbc.queryForObject("SELECT id FROM users WHERE username = ?", Long.class, "qauser");
        spaceId = jdbc.queryForObject("SELECT id FROM spaces WHERE owner_id = ?", Long.class, uid);
    }

    private void seedCache(String url, String title, String summary, long targetSpace) {
        jdbc.update("INSERT INTO briefing_cache (space_id, url, title_zh, summary_zh, image_remote,"
                        + " created_at, updated_at, translation_failed) VALUES (?, ?, ?, ?, '', ?, ?, 0)",
                targetSpace, url, title, summary, Times.now(), Times.now());
    }

    @Test
    @DisplayName("报告扫描坏摘要并给出理由分布，且不扫其它空间")
    void reportFindsBadSummariesAndIsSpaceScoped() throws Exception {
        jdbc.update("DELETE FROM briefing_cache WHERE space_id = ?", spaceId);
        seedCache("https://example.com/good", "好标题", "一段完整且有信息量的中文摘要，说明了方法与结论。", spaceId);
        seedCache("https://example.com/boilerplate", "标题", "RadixArk 在 Hugging Face 上发布的博客文章", spaceId);
        seedCache("https://example.com/null", null, null, spaceId);
        seedCache("https://example.com/latex", "标题", "我们推出 \\textbf{ARCHER} 框架用于推理。", spaceId);
        seedCache("https://example.com/other-space", null, null, spaceId + 9999);

        MvcResult result = mockMvc.perform(get("/api/quality/report")
                        .param("module", "briefing")
                        .session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.module").value("briefing"))
                .andExpect(jsonPath("$.scanned").value(4))
                .andExpect(jsonPath("$.downgraded").value(3))
                .andReturn();
        String body = result.getResponse().getContentAsString();
        assertTrue(body.contains("boilerplate"), body);
        assertTrue(body.contains("missing_text"), body);
        assertTrue(body.contains("latex_residue"), body);
        assertTrue(!body.contains("other-space"), "不得扫到其它空间的数据: " + body);

        MvcResult stored = mockMvc.perform(get("/api/quality/report").param("module", "briefing").session(session))
                .andExpect(status().isOk()).andReturn();
        assertTrue(stored.getResponse().getContentAsString().contains("averageScore"));
    }

    @Test
    @DisplayName("module 非法 → 400，错误格式与既有接口一致")
    void invalidModuleIsRejected() throws Exception {
        mockMvc.perform(get("/api/quality/report").param("module", "weekly").session(session))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").exists());
    }

    @Test
    @DisplayName("迁移已建 content_quality 表，报告会写入可解释结果")
    void reportPersistsResults() throws Exception {
        jdbc.update("DELETE FROM briefing_cache WHERE space_id = ?", spaceId);
        jdbc.update("DELETE FROM content_quality WHERE space_id = ?", spaceId);
        seedCache("https://example.com/persist", "标题", "RadixArk 在 Hugging Face 上发布的博客文章", spaceId);
        mockMvc.perform(get("/api/quality/report").param("module", "briefing").session(session))
                .andExpect(status().isOk());
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM content_quality WHERE space_id = ?",
                Integer.class, spaceId);
        assertEquals(1, count);
        Integer score = jdbc.queryForObject("SELECT score FROM content_quality WHERE space_id = ?",
                Integer.class, spaceId);
        assertEquals(0, score);
    }
}

package com.kb.ops;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

@SpringBootTest
@AutoConfigureMockMvc
class RunMetricsApiTest {

    private static final Path DATA_DIR = tempDir();

    private static Path tempDir() {
        try {
            return Files.createTempDirectory("kb-ops-metrics");
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

    private MockHttpSession admin;
    private MockHttpSession user;
    private long userSpace;

    private MockHttpSession registerAndLogin(String username, String invite) throws Exception {
        String body = "{\"username\":\"" + username + "\",\"displayName\":\"ops\","
                + "\"password\":\"OpsPass123!\",\"inviteCode\":" + (invite == null ? "null" : "\"" + invite + "\"") + "}";
        mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(body));
        var login = mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + username + "\",\"password\":\"OpsPass123!\"}"))
                .andExpect(status().isOk()).andReturn();
        return (MockHttpSession) login.getRequest().getSession(false);
    }

    @BeforeEach
    void setUp() throws Exception {
        admin = registerAndLogin("opsadmin", null);          // 首个用户是管理员
        jdbc.update("INSERT OR REPLACE INTO invites (code, created_by, created_at) VALUES ('OPSINVITE', 1, ?)",
                Times.now());
        user = registerAndLogin("opsuser", "OPSINVITE");
        Long uid = jdbc.queryForObject("SELECT id FROM users WHERE username = ?", Long.class, "opsuser");
        userSpace = jdbc.queryForObject("SELECT id FROM spaces WHERE owner_id = ?", Long.class, uid);
        jdbc.update("DELETE FROM run_metrics");
    }

    private void seed(long spaceId, String module, long runId, String status, long totalMs, int kept,
            long promptTokens) {
        jdbc.update("INSERT INTO run_metrics (space_id, module, run_id, status, total_ms, stage_fetch_ms,"
                        + " stage_enrich_ms, stage_quality_ai_ms, stage_render_ms, items_fetched, items_kept,"
                        + " quality_downgraded, ai_calls, ai_prompt_tokens, ai_completion_tokens, estimated_cost,"
                        + " created_at) VALUES (?, ?, ?, ?, ?, 100, 200, 50, 20, ?, ?, 2, 1, ?, 100, 0, ?)",
                spaceId, module, runId, status, totalMs, kept, kept, promptTokens, Times.now());
    }

    @Test
    @DisplayName("明细按空间隔离：普通用户只看到自己空间的指标")
    void runsAreSpaceScoped() throws Exception {
        seed(userSpace, "briefing", 1, "success", 1000, 15, 500);
        seed(userSpace + 9999, "briefing", 2, "failed", 2000, 0, 0);

        mockMvc.perform(get("/api/ops/runs").session(user))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
        mockMvc.perform(get("/api/ops/runs").session(user))
                .andExpect(jsonPath("$[0].runId").value(1))
                .andExpect(jsonPath("$[0].stageFetchMs").value(100))
                .andExpect(jsonPath("$[0].aiCalls").value(1));
    }

    @Test
    @DisplayName("汇总仅管理员可见，且成功率/分位数来自真实指标")
    void summaryIsAdminOnly() throws Exception {
        seed(userSpace, "briefing", 1, "success", 1000, 15, 500);
        seed(userSpace, "briefing", 2, "partial", 2000, 10, 300);
        seed(userSpace, "briefing", 3, "failed", 3000, 0, 0);

        mockMvc.perform(get("/api/ops/summary").session(user))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").exists());
        mockMvc.perform(get("/api/ops/summary").session(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.runs").value(3))
                .andExpect(jsonPath("$.successRate").value(2.0 / 3))
                .andExpect(jsonPath("$.p50Ms").value(2000))
                .andExpect(jsonPath("$.p95Ms").value(3000))
                .andExpect(jsonPath("$.tokens").value(1100));
    }
}

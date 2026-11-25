package com.kb.briefing;

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
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** 异步 run、分阶段进度、协作式取消、DB 级并发锁。全程 fake 传输，不发网络。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RunLifecycleApiTest.FakeConfig.class)
class RunLifecycleApiTest {

    private static final Path DATA_DIR = tempDir();

    private static Path tempDir() {
        try {
            return Files.createTempDirectory("kb-run-lifecycle");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @TestConfiguration
    static class FakeConfig {
        @Bean
        @Primary
        HttpTransport fakeTransport() {
            return FakeTransport.body("");
        }
    }

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JdbcTemplate jdbc;

    private MockHttpSession session;
    private long spaceId;

    @BeforeEach
    void setUp() throws Exception {
        mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"runuser\",\"displayName\":\"运行验证\","
                        + "\"password\":\"RunPass123!\",\"inviteCode\":null}"));
        var login = mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"runuser\",\"password\":\"RunPass123!\"}"))
                .andExpect(status().isOk()).andReturn();
        session = (MockHttpSession) login.getRequest().getSession(false);
        Long uid = jdbc.queryForObject("SELECT id FROM users WHERE username = ?", Long.class, "runuser");
        spaceId = jdbc.queryForObject("SELECT id FROM spaces WHERE owner_id = ?", Long.class, uid);
        jdbc.update("DELETE FROM run_progress WHERE space_id = ?", spaceId);
        jdbc.update("DELETE FROM briefing_runs WHERE space_id = ?", spaceId);
    }

    @Test
    @DisplayName("?async=true 返回 202 + runId，进度接口能看到阶段推进到终态")
    void asyncRunHasProgress() throws Exception {
        String body = mockMvc.perform(post("/api/briefing/run").param("async", "true").session(session))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.runId").exists())
                .andReturn().getResponse().getContentAsString();
        long runId = Long.parseLong(body.replaceAll(".*\"runId\":(\\d+).*", "$1"));

        String terminal = null;
        for (int i = 0; i < 100; i++) {
            String progress = mockMvc.perform(get("/api/runs/briefing/" + runId + "/progress").session(session))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            if (progress.contains("\"status\":\"done\"") || progress.contains("\"status\":\"failed\"")
                    || progress.contains("\"status\":\"cancelled\"")) {
                terminal = progress;
                break;
            }
            Thread.sleep(100);
        }
        assertTrue(terminal != null, "异步 run 应在 10 秒内到达终态");
        assertTrue(terminal.contains("stageLabel"), "进度应带可展示的阶段文案: " + terminal);
    }

    @Test
    @DisplayName("取消是协作式标记；DB running 行让第二个 run 返回 409")
    void cancelAndDbLock() throws Exception {
        long runId = jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) + 1 FROM briefing_runs", Long.class);
        jdbc.update("INSERT INTO briefing_runs (id, space_id, started_at, status) VALUES (?, ?, ?, 'running')",
                runId, spaceId, Times.now());
        jdbc.update("INSERT INTO run_progress (space_id, module, run_id, status, stage, done, total, cancelled, updated_at)"
                        + " VALUES (?, 'briefing', ?, 'running', 'fetching', 0, 0, 0, ?)",
                spaceId, runId, Times.now());

        mockMvc.perform(post("/api/runs/briefing/" + runId + "/cancel").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(true));
        mockMvc.perform(get("/api/runs/briefing/" + runId + "/progress").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.cancelled").value(true));

        // 同一空间已有 running 行 → DB 唯一索引触发 409
        mockMvc.perform(post("/api/briefing/run").session(session))
                .andExpect(status().isConflict());
        mockMvc.perform(post("/api/briefing/run").param("async", "true").session(session))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("进度不存在时返回 404，错误格式统一")
    void missingProgressIs404() throws Exception {
        mockMvc.perform(get("/api/runs/briefing/99999999/progress").session(session))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").exists());
    }
}

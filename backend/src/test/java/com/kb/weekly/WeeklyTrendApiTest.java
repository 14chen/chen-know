package com.kb.weekly;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
class WeeklyTrendApiTest {

    private static final Path DATA_DIR = tempDir();

    private static Path tempDir() {
        try {
            return Files.createTempDirectory("kb-weekly-trend");
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
        mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"wtrend\",\"displayName\":\"周报验证\","
                        + "\"password\":\"Wtrend123!\",\"inviteCode\":null}"));
        var login = mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"wtrend\",\"password\":\"Wtrend123!\"}"))
                .andExpect(status().isOk()).andReturn();
        session = (MockHttpSession) login.getRequest().getSession(false);
        Long uid = jdbc.queryForObject("SELECT id FROM users WHERE username = ?", Long.class, "wtrend");
        spaceId = jdbc.queryForObject("SELECT id FROM spaces WHERE owner_id = ?", Long.class, uid);
        jdbc.update("DELETE FROM weekly_project_weeks WHERE space_id = ?", spaceId);
        jdbc.update("DELETE FROM weekly_project_profiles WHERE space_id = ?", spaceId);
        jdbc.update("DELETE FROM repo_star_snapshots WHERE space_id = ?", spaceId);
    }

    private void seedProject(String week, String repo, int rank, Integer weeklyStars) {
        jdbc.update("INSERT INTO weekly_project_weeks (space_id, iso_week, source, repo, title, note_id, url,"
                        + " total_stars, weekly_stars, language, rank, theme, created_at)"
                        + " VALUES (?, ?, 'github', ?, ?, ?, ?, ?, ?, 'Java', ?, '工具', ?)",
                spaceId, week, repo, "[GitHub] " + repo, rank, "https://github.com/" + repo,
                1000 + rank, weeklyStars, rank, "2026-11-22T00:00:00Z");
    }

    @Test
    @DisplayName("历史周列表与周总览：Top3 解读、主题分布、新进榜标注")
    void weeksAndDetail() throws Exception {
        seedProject("2026-W47", "a/repo", 1, 320);
        seedProject("2026-W47", "b/repo", 2, 210);
        seedProject("2026-W47", "c/repo", 3, 150);
        seedProject("2026-W47", "d/repo", 4, null);
        seedProject("2026-W46", "a/repo", 1, 120);

        mockMvc.perform(get("/api/weekly/weeks").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].isoWeek").value("2026-W47"))
                .andExpect(jsonPath("$[1].isoWeek").value("2026-W46"));
        mockMvc.perform(get("/api/weekly/week/2026-W47").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projects.length()").value(4))
                .andExpect(jsonPath("$.highlights.length()").value(3))
                .andExpect(jsonPath("$.themes.工具").value(4))
                .andExpect(jsonPath("$.highlights[0].aiGenerated").value(false))
                .andExpect(jsonPath("$.highlights[0].whyItMatters").exists());
    }

    @Test
    @DisplayName("星增序列来自真实相邻快照：首点无 delta，后续为差值")
    void starHistoryUsesAdjacentSnapshots() throws Exception {
        jdbc.update("INSERT INTO repo_star_snapshots (space_id, source, repo, stars, captured_at) VALUES"
                + " (?, 'github', 'a/repo', 1000, '2026-11-01T00:00:00Z'),"
                + " (?, 'github', 'a/repo', 1100, '2026-11-08T00:00:00Z'),"
                + " (?, 'github', 'a/repo', 1150, '2026-11-15T00:00:00Z')",
                spaceId, spaceId, spaceId);
        mockMvc.perform(get("/api/weekly/repos/stars").param("source", "github").param("repo", "a/repo").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].delta").doesNotExist())
                .andExpect(jsonPath("$[1].delta").value(100))
                .andExpect(jsonPath("$[2].delta").value(50));
    }

    @Test
    @DisplayName("ISO 周回溯计算正确")
    void previousIsoWeek() {
        assertEquals("2026-W46", WeeklyExperienceService.previousIsoWeek("2026-W47"));
        assertEquals("2025-W52", WeeklyExperienceService.previousIsoWeek("2026-W01"));
    }
}

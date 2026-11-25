package com.kb.ops;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
class RetentionServiceTest {

    private static final Path DATA_DIR = tempDir();

    private static Path tempDir() {
        try {
            return Files.createTempDirectory("kb-retention");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @Autowired
    private RetentionService service;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("dry-run 只统计不删除；正式清理只删元数据表，笔记与运行历史不变")
    void dryRunThenClean() {
        jdbc.update("DELETE FROM run_metrics");
        jdbc.update("DELETE FROM run_progress");
        jdbc.update("INSERT INTO run_metrics (space_id, module, run_id, status, created_at)"
                + " VALUES (1, 'briefing', 901, 'success', '2000-01-01T00:00:00Z')");
        jdbc.update("INSERT INTO run_progress (space_id, module, run_id, status, stage, updated_at)"
                + " VALUES (1, 'briefing', 901, 'done', 'done', '2000-01-01T00:00:00Z')");
        int notesBefore = jdbc.queryForObject("SELECT COUNT(*) FROM notes", Integer.class);
        int runsBefore = jdbc.queryForObject("SELECT COUNT(*) FROM briefing_runs", Integer.class);

        var dry = service.clean(true);
        assertTrue(dry.get("run_metrics") >= 1);
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM run_metrics", Integer.class), "dry-run 不删数据");

        var done = service.clean(false);
        assertTrue(done.get("run_metrics") >= 1);
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM run_metrics", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM run_progress", Integer.class));
        assertEquals(notesBefore, jdbc.queryForObject("SELECT COUNT(*) FROM notes", Integer.class));
        assertEquals(runsBefore, jdbc.queryForObject("SELECT COUNT(*) FROM briefing_runs", Integer.class));
    }
}

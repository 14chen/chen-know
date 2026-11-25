package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
class SourceHealthTest {

    private static final Path DATA_DIR = tempDir();

    private static Path tempDir() {
        try {
            return Files.createTempDirectory("kb-source-health");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @Autowired
    private SourceHealthRepository repository;
    @Autowired
    private SourceHealthService service;
    @Autowired
    private JdbcTemplate jdbc;

    private long spaceId;

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM source_health");
        spaceId = 900_000L + System.nanoTime() % 1000;
    }

    @Test
    @DisplayName("连续 5 次失败进入 30 分钟冷却，成功一次立刻清零恢复")
    void cooldownAfterFiveFailures() {
        for (int i = 0; i < 5; i++) {
            repository.record(spaceId, "briefing", "openai", false, 1200);
        }
        String until = repository.cooldownUntil(spaceId, "briefing", "openai");
        assertNotNull(until, "5 次失败后应进入冷却");
        SourceHealth health = repository.find(spaceId, "briefing", "openai").orElseThrow();
        assertEquals("cooling", health.state());
        assertTrue(health.statusMessage().contains("冷却中"));
        assertEquals(1200, health.lastLatencyMs());
        assertTrue(health.p95LatencyMs() >= 1200, "p95 来自最近延迟窗口");

        repository.record(spaceId, "briefing", "openai", true, 300);
        assertNull(repository.cooldownUntil(spaceId, "briefing", "openai"), "成功后应恢复");
        assertEquals("ok", repository.find(spaceId, "briefing", "openai").orElseThrow().state());
    }

    @Test
    @DisplayName("静态 skip 源在列表中标记为 skipped")
    void staticSkipIsMarked() {
        var list = service.list(spaceId);
        assertTrue(list.stream().anyMatch(health -> "importai".equals(health.sourceId()) && health.staticallySkipped()));
        assertEquals("skipped", list.stream().filter(h -> "importai".equals(h.sourceId())).findFirst().orElseThrow().state());
    }
}

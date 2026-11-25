package com.kb.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
class StructuredAnalysisServiceTest {

    private static final Path DATA_DIR = tempDir();

    private static Path tempDir() {
        try {
            return Files.createTempDirectory("kb-ai-analysis");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    @Autowired
    private AnalysisCache cache;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private AnalysisClient defaultBean;

    private static final class FakeClient implements AnalysisClient {
        int calls;
        Optional<AnalysisResult> next = Optional.of(new AnalysisResult("一句话", java.util.List.of("点一"),
                null, null, java.util.List.of(), 0.8, java.util.List.of()));

        @Override
        public Optional<AnalysisResult> analyze(AnalysisRequest request) {
            calls++;
            return next;
        }

        @Override
        public String providerName() {
            return "fake";
        }
    }

    private AnalysisProperties props() {
        AnalysisProperties p = new AnalysisProperties();
        p.setEnabled(true);
        p.setProvider("openai-compatible");
        p.setMaxItemsPerRun(2);
        return p;
    }

    @BeforeEach
    void clear() {
        jdbc.update("DELETE FROM ai_analysis");
    }

    @Test
    @DisplayName("默认配置下 Spring 注入的 bean 是 Noop（真实应用零外呼）")
    void defaultBeanIsNoop() {
        assertEquals("none", defaultBean.providerName());
    }

    @Test
    @DisplayName("provider=none / enabled=false 时一次客户端调用都不发")
    void disabledDoesNothing() {
        FakeClient fake = new FakeClient();
        AnalysisProperties p = new AnalysisProperties();   // 默认关闭
        StructuredAnalysisService service = new StructuredAnalysisService(p, fake, cache);
        service.beginRun();
        assertTrue(service.analyze(1L, "briefing", "u1", new AnalysisRequest("t", "s", "openai")).isEmpty());
        assertEquals(0, fake.calls);
    }

    @Test
    @DisplayName("首次调用落缓存，同内容第二次命中缓存不再调用客户端")
    void cachesByContentHash() {
        FakeClient fake = new FakeClient();
        StructuredAnalysisService service = new StructuredAnalysisService(props(), fake, cache);
        service.beginRun();
        AnalysisRequest request = new AnalysisRequest("标题", "摘要", "openai");
        assertTrue(service.analyze(1L, "briefing", "u1", request).isPresent());
        assertTrue(service.analyze(1L, "briefing", "u1", request).isPresent());
        assertEquals(1, fake.calls);
    }

    @Test
    @DisplayName("内容变化后重新分析（缓存键含 content_hash）")
    void changedContentIsReanalyzed() {
        FakeClient fake = new FakeClient();
        StructuredAnalysisService service = new StructuredAnalysisService(props(), fake, cache);
        service.beginRun();
        service.analyze(1L, "briefing", "u1", new AnalysisRequest("标题", "摘要A", "openai"));
        service.analyze(1L, "briefing", "u1", new AnalysisRequest("标题", "摘要B", "openai"));
        assertEquals(2, fake.calls);
    }

    @Test
    @DisplayName("超出单次运行预算后跳过分析，不调用客户端")
    void budgetIsEnforced() {
        FakeClient fake = new FakeClient();
        StructuredAnalysisService service = new StructuredAnalysisService(props(), fake, cache);
        service.beginRun();
        service.analyze(1L, "briefing", "u1", new AnalysisRequest("t1", "s1", "openai"));
        service.analyze(1L, "briefing", "u2", new AnalysisRequest("t2", "s2", "openai"));
        assertTrue(service.analyze(1L, "briefing", "u3", new AnalysisRequest("t3", "s3", "openai")).isEmpty());
        assertEquals(2, fake.calls);
    }

    @Test
    @DisplayName("客户端失败 → empty 且不写缓存；下一轮仍可重试")
    void failureIsNotCached() {
        FakeClient fake = new FakeClient();
        fake.next = Optional.empty();
        StructuredAnalysisService service = new StructuredAnalysisService(props(), fake, cache);
        service.beginRun();
        assertTrue(service.analyze(1L, "briefing", "u1", new AnalysisRequest("t", "s", "openai")).isEmpty());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM ai_analysis", Integer.class));
        fake.next = Optional.of(new AnalysisResult("恢复", java.util.List.of("点"), null, null,
                java.util.List.of(), 0.9, java.util.List.of()));
        assertTrue(service.analyze(1L, "briefing", "u1", new AnalysisRequest("t", "s", "openai")).isPresent());
        assertFalse(fake.next.isEmpty());
    }
}

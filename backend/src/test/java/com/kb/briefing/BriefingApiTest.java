package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.kb.common.ApiException;
import com.kb.common.ErrorCode;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
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
import org.springframework.test.web.servlet.MvcResult;

/**
 * BRIEFING.md §9 的后端验收（1/3/4/5/7/9/15）：全部走 fake 传输层，<b>测试里绝不发真实网络请求</b>。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(BriefingApiTest.FakeConfig.class)
class BriefingApiTest {

    private static final Path DATA_DIR = createDataDir();
    /** 可拨动的时钟：补抓逻辑靠它验证「已过生成时刻 / 今天已跑过」。 */
    private static final MutableClock CLOCK = new MutableClock(Instant.parse("2026-10-18T04:00:00Z"));
    private static final FakeHttpTransport TRANSPORT = new FakeHttpTransport();

    private static final String USER = "demo";
    private static final String PASSWORD = "demoPass123";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
        registry.add("kb.briefing.owner", () -> USER);
        registry.add("kb.briefing.folder", () -> "简报归档");
        registry.add("kb.briefing.tags", () -> "AI简报,每日");
        registry.add("kb.briefing.per-source", () -> "3");
        registry.add("kb.briefing.translate", () -> "true");
        registry.add("kb.briefing.fetch-article", () -> "true");
        registry.add("kb.briefing.max-images", () -> "2");
        // 与生产一致：补抓的「今天的生成时刻」由 cron 的「分 时」推出 = 18:30
        registry.add("kb.briefing.cron", () -> "0 30 18 * * *");
    }

    @TestConfiguration
    static class FakeConfig {

        @Bean
        @Primary
        FakeHttpTransport fakeHttpTransport() {
            return TRANSPORT;
        }

        @Bean
        @Primary
        Clock briefingTestClock() {
            return CLOCK;
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private BriefingService briefingService;

    @Autowired
    private BriefingProperties properties;

    @Autowired
    private BriefingEnricher enricher;

    @Autowired
    private BriefingAttachmentIndex attachmentIndex;

    @Autowired
    private java.util.concurrent.ExecutorService briefingExecutor;

    private static MockHttpSession session;
    private static long spaceId;
    private static long userId;

    @BeforeEach
    void setUp() throws Exception {
        if (session == null) {
            mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                            .content(("{\"username\":\"" + USER + "\",\"displayName\":\"演示\","
                                    + "\"password\":\"" + PASSWORD + "\",\"inviteCode\":null}")
                                    .getBytes(StandardCharsets.UTF_8)))
                    .andExpect(status().isCreated());
            MvcResult login = mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                            .content(("{\"username\":\"" + USER + "\",\"password\":\"" + PASSWORD + "\"}")
                                    .getBytes(StandardCharsets.UTF_8)))
                    .andExpect(status().isOk()).andReturn();
            session = (MockHttpSession) login.getRequest().getSession(false);
            userId = jdbc.queryForObject("SELECT id FROM users WHERE username = ?", Long.class, USER);
            spaceId = jdbc.queryForObject("SELECT id FROM spaces WHERE owner_id = ?", Long.class, userId);
            mockMvc.perform(post("/api/folders").session(session).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"parentId\":null,\"name\":\"简报归档\"}"
                                    .getBytes(StandardCharsets.UTF_8)))
                    .andExpect(status().isCreated());
            seedFixtures();
        }
        TRANSPORT.failing.clear();
        TRANSPORT.gate = null;
        TRANSPORT.gatedAt.set(0);
        CLOCK.set("2026-10-18T04:00:00Z");
        waitForStartupCatchUp();
    }

    /** 启动补抓跑在后台线程上；先把它排空，避免它在测试拨动时钟之后插进来。 */
    private void waitForStartupCatchUp() {
        try {
            briefingExecutor.submit(() -> {
            }).get(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            Thread.currentThread().interrupt();
        }
    }

    /** 清空跨天去重表，让「第一次运行」的断言与用例顺序无关。 */
    private void resetSeen() {
        jdbc.update("DELETE FROM briefing_seen WHERE space_id = ?", spaceId);
    }

    @Test
    @DisplayName("§9-1/2/7/15 手动运行：写笔记、落在配置目录、带标签、每条都有原始链接、无未转义 HTML")
    void manualRunWritesNote() throws Exception {
        resetSeen();
        MvcResult result = mockMvc.perform(post("/api/briefing/run").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.official").doesNotExist())
                .andReturn();
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        // 每源上限 3 → openai 只取 3 条；importai 被 skip-sources 跳过 → 总计 15 条
        assertTrue(body.contains("\"totalItems\":15"), body);
        assertTrue(body.contains("\"newItems\":15"), body);
        long noteId = Long.parseLong(body.replaceAll(".*\"noteId\":(\\d+).*", "$1"));

        String markdown = jdbc.queryForObject("SELECT content FROM notes WHERE id = ?", String.class, noteId);
        assertTrue(markdown.startsWith("# AI 简报 2026-10-18"), markdown);
        assertTrue(markdown.contains("## 国外 · 一手") && markdown.contains("### OpenAI"), markdown);
        assertTrue(markdown.contains("链接：https://openai.com/news/1"), "每条都要有原始链接: " + markdown);
        assertTrue(markdown.contains("#### 1. "), "每条标题单独成行: " + markdown);
        assertTrue(markdown.contains("· 128 分"), "HN 要带分数: " + markdown);
        assertFalse(markdown.contains("<p>") || markdown.contains("<b>") || markdown.contains("<a "),
                "正文不得出现未转义 HTML: " + markdown);

        assertEquals("简报归档", jdbc.queryForObject("SELECT f.name FROM notes n JOIN folders f"
                + " ON f.id = n.folder_id WHERE n.id = ?", String.class, noteId));
        List<String> tags = jdbc.queryForList("SELECT t.name FROM note_tags nt JOIN tags t"
                + " ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.name", String.class, noteId);
        assertEquals(List.of("AI简报", "每日"), tags);
        assertTrue(markdown.contains("### 跳过的源（已知不可达）"), "跳过的源要单独成块: " + markdown);
        assertTrue(markdown.contains("Import AI：已知不可达"), markdown);

        mockMvc.perform(get("/api/briefing/runs?limit=5").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].status").value("success"))
                .andExpect(jsonPath("$.items[0].newItems").value(15))
                .andExpect(jsonPath("$.items[0].sourceReport.length()").value(10))
                .andExpect(jsonPath("$.items[0].sourceReport[0].ok").value(true));
    }

    @Test
    @DisplayName("skip-sources：已知反爬源不发请求、不计失败、status 仍为 success，但源清单里标注")
    void skippedSourceIsNotFetched() throws Exception {
        resetSeen();
        mockMvc.perform(post("/api/briefing/run").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.sourceReport.length()").value(10))
                .andExpect(jsonPath("$.sourceReport[?(@.source == 'importai')].skipped")
                        .value(org.hamcrest.Matchers.hasItem(true)))
                .andExpect(jsonPath("$.sourceReport[?(@.source == 'importai')].ok")
                        .value(org.hamcrest.Matchers.hasItem(true)));
        assertFalse(TRANSPORT.requested.stream().anyMatch(url -> url.startsWith(BriefingSources.byId("importai").url())),
                "被跳过的源不得发起请求: " + TRANSPORT.requested);

        mockMvc.perform(get("/api/briefing/sources").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id == 'importai')].skipped")
                        .value(org.hamcrest.Matchers.hasItem(true)))
                .andExpect(jsonPath("$.items[?(@.id == 'importai')].note")
                        .value(org.hamcrest.Matchers.hasItem(org.hamcrest.Matchers.containsString("反爬"))))
                .andExpect(jsonPath("$.items[?(@.id == 'openai')].skipped")
                        .value(org.hamcrest.Matchers.hasItem(false)));
    }

    @Test
    @DisplayName("§9-3 连续两次：第二次 newItems=0，且仍然写一条极短简报（不静默跳过）")
    void secondRunDedupes() throws Exception {
        resetSeen();
        mockMvc.perform(post("/api/briefing/run").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.newItems").value(15));
        MvcResult second = mockMvc.perform(post("/api/briefing/run").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.newItems").value(0))
                .andExpect(jsonPath("$.totalItems").value(15))
                .andReturn();
        String body = second.getResponse().getContentAsString(StandardCharsets.UTF_8);
        long noteId = Long.parseLong(body.replaceAll(".*\"noteId\":(\\d+).*", "$1"));
        String markdown = jdbc.queryForObject("SELECT content FROM notes WHERE id = ?", String.class, noteId);
        assertTrue(markdown.contains("今天没有新的 AI 资讯（检查 15 条，全部已收录过）"), markdown);
    }

    @Test
    @DisplayName("§9-4 单源失败不致命：其余源照常，正文末尾出现「本次未取到」+ 具体原因")
    void singleSourceFailureIsNonFatal() throws Exception {
        resetSeen();
        TRANSPORT.failing.add(BriefingSources.byId("anthropic").url());
        // 9 个可跑源里坏 1 个 = 抖动容忍范围内 → status 仍是 success，
        // 但失败必须如实写进正文的「本次未取到」，绝不隐瞒
        MvcResult result = mockMvc.perform(post("/api/briefing/run").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.sourceReport[?(@.source == 'anthropic')].ok")
                        .value(org.hamcrest.Matchers.hasItem(false)))
                .andReturn();
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        long noteId = Long.parseLong(body.replaceAll(".*\"noteId\":(\\d+).*", "$1"));
        String markdown = jdbc.queryForObject("SELECT content FROM notes WHERE id = ?", String.class, noteId);
        assertTrue(markdown.contains("### 本次未取到"), markdown);
        assertTrue(markdown.contains("- Anthropic：HTTP 403（fake）"), markdown);
        assertTrue(markdown.contains("链接：https://openai.com/news/1"), "其余源照常: " + markdown);
    }

    @Test
    @DisplayName("§9-5 并发保护：同一空间同时只允许一个 run，第二个 409")
    void concurrentRunConflicts() throws Exception {
        CountDownLatch gate = new CountDownLatch(1);
        TRANSPORT.gateUrl = BriefingSources.byId("openai").url();
        TRANSPORT.gate = gate;
        AtomicReference<Object> firstResult = new AtomicReference<>();
        Thread worker = new Thread(() -> {
            try {
                firstResult.set(briefingService.run(userId, spaceId));
            } catch (RuntimeException e) {
                firstResult.set(e);
            }
        }, "briefing-concurrent-test");
        worker.start();
        try {
            long deadline = System.currentTimeMillis() + 10_000;
            while (TRANSPORT.gatedAt.get() == 0 && System.currentTimeMillis() < deadline) {
                Thread.sleep(20);
            }
            mockMvc.perform(post("/api/briefing/run").session(session))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.error.code").value("CONFLICT"));
        } finally {
            gate.countDown();
            worker.join(20_000);
        }
        assertTrue(firstResult.get() instanceof BriefingRunResponse,
                "第一个 run 应当成功完成: " + firstResult.get());
    }

    @Test
    @DisplayName("启动补抓：没到点不跑；到点且今天没跑过 → 跑一次；再调用不重复")
    void catchUpRunsOnlyWhenDue() {
        long before = countRuns();
        CLOCK.set("2026-10-20T04:00:00Z");            // 12:00 +08:00，未到 18:30
        briefingService.runIfDue("test-too-early");
        assertEquals(before, countRuns(), "未到生成时刻不得补抓");

        CLOCK.set("2026-10-20T11:00:00Z");            // 19:00 +08:00，已过 18:30
        briefingService.runIfDue("test-catch-up");
        assertEquals(before + 1, countRuns(), "已过时刻且今天没跑过 → 补抓一次");

        briefingService.runIfDue("test-catch-up-again");
        assertEquals(before + 1, countRuns(), "今天已经跑过 → 不再补抓");
        assertEquals("success", jdbc.queryForObject(
                "SELECT status FROM briefing_runs WHERE space_id = ? AND substr(started_at,1,10) = '2026-10-20'"
                        + " ORDER BY id DESC LIMIT 1", String.class, spaceId));
    }

    @Test
    @DisplayName("§9-6 源清单：10 个源、URL 与契约一致、三种形态齐全")
    void sourcesEndpoint() throws Exception {
        mockMvc.perform(get("/api/briefing/sources").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(10))
                .andExpect(jsonPath("$.items[?(@.id == 'importai')].url")
                        .value(org.hamcrest.Matchers.hasItem("https://www.importai.net/feed")))
                .andExpect(jsonPath("$.items[?(@.kind == 'JSON')].id")
                        .value(org.hamcrest.Matchers.hasItem("hackernews")))
                .andExpect(jsonPath("$.items[?(@.kind == 'HTML')].id").isNotEmpty());
    }

    @Test
    @DisplayName("未登录访问简报接口 → 401（不泄露数据）")
    void requiresLogin() throws Exception {
        mockMvc.perform(post("/api/briefing/run")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/briefing/runs")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("测试里绝不发真实网络请求：装配的是 fake 传输层，且它确实被调用过")
    void usesFakeTransportOnly() throws Exception {
        mockMvc.perform(post("/api/briefing/run").session(session));
        assertFalse(TRANSPORT.requested.isEmpty(), "抓取必须经过 fake 传输层");
        assertTrue(TRANSPORT.requested.stream().allMatch(url -> url.startsWith("http")), "只可能是源 URL");
    }

    @Test
    @DisplayName("并发锁释放后可以再次运行（不会永久卡住）")
    void lockIsReleasedAfterRun() {
        TRANSPORT.failing.add(BriefingSources.byId("openai").url());
        briefingService.run(userId, spaceId);
        BriefingRunResponse again = briefingService.run(userId, spaceId);
        assertNotNull(again);
        assertFalse("failed".equals(again.status()), "锁释放后第二次运行必须能正常完成: " + again);
    }

    @Test
    @DisplayName("未配置 owner 时补抓直接跳过（不抛异常）")
    void catchUpWithoutOwnerIsNoop() {
        String original = properties.getOwner();
        long before = countRuns();
        try {
            properties.setOwner("");
            CLOCK.set("2026-10-21T11:00:00Z");
            briefingService.runIfDue("no-owner");
        } finally {
            properties.setOwner(original);
        }
        assertEquals(before, countRuns(), "没配 owner 不得产生 run");
    }

    @Test
    @DisplayName("ApiException 的冲突码确实是 CONFLICT（HTTP 409 的来源）")
    void conflictCodeIsConflict() {
        TRANSPORT.gate = new CountDownLatch(1);
        TRANSPORT.gateUrl = BriefingSources.byId("openai").url();
        Thread worker = new Thread(() -> briefingService.run(userId, spaceId), "briefing-conflict-code");
        worker.start();
        try {
            long deadline = System.currentTimeMillis() + 10_000;
            while (TRANSPORT.gatedAt.get() == 0 && System.currentTimeMillis() < deadline) {
                Thread.sleep(20);
            }
            ApiException conflict = assertThrows(ApiException.class, () -> briefingService.run(userId, spaceId));
            assertEquals(ErrorCode.CONFLICT, conflict.code());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            TRANSPORT.gate.countDown();
            try {
                worker.join(20_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    @Test
    @DisplayName("富化：英文标题被翻译成中文、配图落库成附件、笔记里中英对照并引用图片")
    void enrichesWithTranslationAndImage() throws Exception {
        resetSeen();
        MvcResult result = mockMvc.perform(post("/api/briefing/run").session(session))
                .andExpect(status().isOk())
                .andReturn();
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        long noteId = Long.parseLong(body.replaceAll(".*\"noteId\":(\\d+).*", "$1"));
        String markdown = jdbc.queryForObject("SELECT content FROM notes WHERE id = ?", String.class, noteId);

        assertTrue(markdown.contains("中文译文：模型发布"), "标题应被翻译: " + markdown);
        assertTrue(markdown.contains("原题："), "要有原文对照: " + markdown);
        assertTrue(markdown.contains("OpenAI 在这篇文章里详细介绍了编码代理的新模型与评测结果。"),
                "摘要应来自文章页 og:description: " + markdown);
        assertTrue(markdown.contains("![](/api/attachments/"), "要有配图引用: " + markdown);

        // 配图真的能取回（附件接口 200）
        long attachmentId = Long.parseLong(markdown.replaceAll("(?s).*?!\\[\\]\\(/api/attachments/(\\d+)\\).*", "$1"));
        MvcResult download = mockMvc.perform(get("/api/attachments/" + attachmentId).session(session))
                .andExpect(status().isOk()).andReturn();
        assertTrue(download.getResponse().getContentAsByteArray().length > 0, "图片应有字节");
    }

    @Test
    @DisplayName("全部源失败 → status=failed，但仍写一条只含「本次未取到」的简报（不隐瞒）")
    void allSourcesFailingMakesFailed() throws Exception {
        resetSeen();
        for (BriefingSource source : BriefingSources.ALL) {
            if (!properties.isSkipped(source.id())) {
                TRANSPORT.failing.add(source.url());
            }
        }
        MvcResult result = mockMvc.perform(post("/api/briefing/run").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("failed"))
                .andReturn();
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertTrue(body.contains("\"noteId\":") && !body.contains("\"noteId\":null"),
                "失败也要留下简报正文: " + body);
        long noteId = Long.parseLong(body.replaceAll(".*\"noteId\":(\\d+).*", "$1"));
        String markdown = jdbc.queryForObject("SELECT content FROM notes WHERE id = ?", String.class, noteId);
        assertTrue(markdown.contains("### 本次未取到"), markdown);
        assertTrue(markdown.contains("OpenAI：HTTP 403（fake）"), markdown);
    }

    @Test
    @DisplayName("缓存：同一 URL 第二次富化不再抓文章页、不再重复下载配图")
    void enrichmentIsCached() {
        // 独占 URL + 独占图片，避免与其他用例的缓存互相干扰
        String probeUrl = "https://openai.com/news/cache-probe";
        String probeImage = "https://cdn.example.com/cache-probe.png";
        TRANSPORT.bodies.put(probeUrl, """
                <html><head>
                <meta property="og:description" content="Cache probe description that is long enough to be used.">
                <meta property="og:image" content="%s">
                </head><body></body></html>
                """.formatted(probeImage));
        TRANSPORT.bodies.put(probeImage, "png");
        long articlesBefore = TRANSPORT.requested.stream().filter(probeUrl::equals).count();
        int attachmentsBefore = jdbc.queryForObject(
                "SELECT COUNT(*) FROM attachments WHERE space_id = ?", Integer.class, spaceId);
        com.kb.user.KbPrincipal principal = new com.kb.user.KbPrincipal(userId, USER, "演示", "admin", spaceId);
        BriefingEnricher.Target target = new BriefingEnricher.Target(probeUrl,
                "A brand new model", "short rss summary", "openai", 1);

        java.util.Map<String, BriefingEnricher.Enrichment> first = enricher.enrichAll(principal, List.of(target));
        long articlesAfterFirst = TRANSPORT.requested.stream().filter(probeUrl::equals).count();
        java.util.Map<String, BriefingEnricher.Enrichment> second = enricher.enrichAll(principal, List.of(target));
        long articlesAfterSecond = TRANSPORT.requested.stream().filter(probeUrl::equals).count();

        assertEquals(articlesBefore + 1, articlesAfterFirst, "第一次应抓一次文章页");
        assertEquals(articlesAfterFirst, articlesAfterSecond, "第二次命中缓存，不再抓文章页");
        assertEquals(first.get(target.url()).displayTitle(), second.get(target.url()).displayTitle());
        assertEquals(first.get(target.url()).imageRef(), second.get(target.url()).imageRef());
        int attachmentsAfter = jdbc.queryForObject(
                "SELECT COUNT(*) FROM attachments WHERE space_id = ?", Integer.class, spaceId);
        assertEquals(attachmentsBefore + 1, attachmentsAfter, "配图只落库一次");
    }

    @Test
    @DisplayName("翻译成对：标题能翻、摘要翻不了 → 两者都保留原文（不允许中文标题+英文摘要）")
    void translationIsAllOrNothing() {
        String url = "https://openai.com/news/pair-probe";
        com.kb.user.KbPrincipal principal = new com.kb.user.KbPrincipal(userId, USER, "演示", "admin", spaceId);
        BriefingEnricher.Target target = new BriefingEnricher.Target(url,
                "A perfectly translatable English title", "TRANSFAIL english summary text", "openai", 2);
        java.util.Map<String, BriefingEnricher.Enrichment> result = enricher.enrichAll(principal, List.of(target));
        BriefingEnricher.Enrichment enrichment = result.get(url);
        assertNotNull(enrichment);
        // 摘要那一侧失败 → 整体回退：标题也不翻，保持原文，绝不混搭
        assertNull(enrichment.displayTitle(), "摘要翻不了时标题也不许只翻一半: " + enrichment);
        assertNull(enrichment.displaySummary(), String.valueOf(enrichment));
    }

    @Test
    @DisplayName("配图去重：同一篇里同一张图只用一次；同 sha256 已有附件则复用不重传")
    void imagesAreDeduplicatedBySha256() {
        com.kb.user.KbPrincipal principal = new com.kb.user.KbPrincipal(userId, USER, "演示", "admin", spaceId);
        String sharedImage = "https://cdn.example.com/shared-default-cover.png";
        String articleA = "https://www.anthropic.com/news/dedupe-a";
        String articleB = "https://www.anthropic.com/news/dedupe-b";
        String page = """
                <html><head><meta property="og:description" content="A long enough description for dedupe.">
                <meta property="og:image" content="%s"></head><body></body></html>
                """.formatted(sharedImage);
        TRANSPORT.bodies.put(sharedImage, "png");
        TRANSPORT.bodies.put(articleA, page);
        TRANSPORT.bodies.put(articleB, page);
        int before = jdbc.queryForObject("SELECT COUNT(*) FROM attachments WHERE space_id = ?",
                Integer.class, spaceId);

        java.util.Map<String, BriefingEnricher.Enrichment> sameRun = enricher.enrichAll(principal, List.of(
                new BriefingEnricher.Target(articleA, "T", "S", "anthropic", 1),
                new BriefingEnricher.Target(articleB, "T", "S", "anthropic", 2)));
        int afterFirstRun = jdbc.queryForObject("SELECT COUNT(*) FROM attachments WHERE space_id = ?",
                Integer.class, spaceId);
        assertEquals(before + 1, afterFirstRun, "同一张图在同一篇简报里只落库一次");

        // 换个 URL 再指向同一张图 → 复用已有附件（sha256 命中），不再上传
        String articleC = "https://www.anthropic.com/news/dedupe-c";
        TRANSPORT.bodies.put(articleC, page);
        enricher.enrichAll(principal, List.of(
                new BriefingEnricher.Target(articleC, "T", "S", "anthropic", 3)));
        int afterSecondRun = jdbc.queryForObject("SELECT COUNT(*) FROM attachments WHERE space_id = ?",
                Integer.class, spaceId);
        assertEquals(afterFirstRun, afterSecondRun, "同 sha256 的图不许再存一份");
        int duplicates = jdbc.queryForObject("SELECT COUNT(*) FROM (SELECT sha256 FROM attachments"
                + " WHERE space_id = ? GROUP BY sha256 HAVING COUNT(*) > 1)", Integer.class, spaceId);
        assertEquals(0, duplicates, "attachments 里 sha256 不许有重复");
    }

    @Test
    @DisplayName("附件挂到笔记上：回填 note_id；原始名是 {源}-{序号}.ext")
    void attachmentsAreLinkedToNote() {
        com.kb.user.KbPrincipal principal = new com.kb.user.KbPrincipal(userId, USER, "演示", "admin", spaceId);
        String article = "https://www.anthropic.com/news/note-link-probe";
        String image = "https://cdn.example.com/note-link-probe.png";
        TRANSPORT.bodies.put(image, "png");
        TRANSPORT.bodies.put(article, """
                <html><head><meta property="og:image" content="%s"></head><body></body></html>
                """.formatted(image));
        BriefingEnricher.Enrichment enrichment = enricher.enrichAll(principal,
                List.of(new BriefingEnricher.Target(article, "T", "S", "anthropic", 7))).get(article);
        assertNotNull(enrichment.attachmentId(), "应该有附件");

        long noteId = jdbc.queryForObject("SELECT MAX(id) FROM notes WHERE space_id = ?", Long.class, spaceId);
        assertEquals(1, attachmentIndex.backfillNoteId(spaceId, noteId, List.of(enrichment.attachmentId())));
        assertEquals(noteId, jdbc.queryForObject("SELECT note_id FROM attachments WHERE id = ?",
                Long.class, enrichment.attachmentId()));
        String originalName = jdbc.queryForObject("SELECT original_name FROM attachments WHERE id = ?",
                String.class, enrichment.attachmentId());
        assertTrue(originalName.matches("anthropic-7\\.(png|jpg|webp)"), originalName);
    }

    private long countRuns() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM briefing_runs WHERE space_id = ?", Long.class, spaceId);
        return count == null ? 0 : count;
    }

    // ---------------------------------------------------------------- 固定样本（不联网）

    private static void seedFixtures() {
        TRANSPORT.bodies.put(BriefingSources.byId("openai").url(), rss("https://openai.com/news/", 5));
        TRANSPORT.bodies.put(BriefingSources.byId("deepmind").url(), rss("https://deepmind.google/blog/", 2));
        TRANSPORT.bodies.put(BriefingSources.byId("techmeme").url(), """
                <?xml version="1.0"?><rss version="2.0"><channel>
                <item><title>Techmeme 头条</title><link>https://www.techmeme.com/251018/p1</link>
                <description><![CDATA[<p><a href="https://example.com/real">real</a></p>]]></description></item>
                </channel></rss>
                """);
        TRANSPORT.bodies.put(BriefingSources.byId("qbitai").url(), rss("https://www.qbitai.com/", 1));
        TRANSPORT.bodies.put(BriefingSources.byId("huggingface").url(), rss("https://huggingface.co/blog/", 1));
        TRANSPORT.bodies.put(BriefingSources.byId("importai").url(), rss("https://www.importai.net/", 1));
        TRANSPORT.bodies.put(BriefingSources.byId("anthropic").url(), """
                <html><body>
                <a href="/news/claude-4">Claude 4 发布：推理能力大幅提升</a>
                <a href="/news/safety">Anthropic 安全报告</a>
                </body></html>
                """);
        TRANSPORT.bodies.put(BriefingSources.byId("arxiv").url(), """
                <html><body>
                <dt><a href="/abs/2510.01234v1" title="Abstract">arXiv:2510.01234</a></dt>
                <dd><div class='list-title is-inline-block'><span class='descriptor'>Title:</span>
                Large Language Models for Everything</div></dd>
                <dt><a href="/abs/2510.05678v1" title="Abstract">arXiv:2510.05678</a></dt>
                <dd><div class='list-title is-inline-block'><span class='descriptor'>Title:</span>
                A Study of Something Interesting</div></dd>
                </body></html>
                """);
        TRANSPORT.bodies.put(BriefingSources.byId("jiqizhixin").url(), """
                <html><body><a href="/articles/abc">大模型推理成本再降</a></body></html>
                """);
        // 文章页：og:description（更充实）+ og:image（可下载）
        TRANSPORT.bodies.put("https://openai.com/news/1", """
                <html><head>
                <meta property="og:description" content="OpenAI 在这篇文章里详细介绍了编码代理的新模型与评测结果。">
                <meta property="og:image" content="https://cdn.example.com/hero.png">
                </head><body><p>正文段落。</p></body></html>
                """);
        TRANSPORT.bodies.put("https://cdn.example.com/hero.png", "png");
        // 机器翻译端点（前缀匹配）：固定返回中文
        TRANSPORT.bodies.put("https://api.mymemory.translated.net/get?",
                "{\"responseData\":{\"translatedText\":\"中文译文：模型发布\"},\"responseStatus\":200}");
        TRANSPORT.bodies.put(BriefingSources.byId("hackernews").url(), """
                {"hits":[
                  {"objectID":"1","title":"AI story","url":"https://example.com/hn-1","points":128,
                   "created_at":"2026-10-18T01:00:00Z"},
                  {"objectID":"2","title":"Ask HN: AI","url":null,"points":7,"created_at":"2026-10-18T02:00:00Z"}
                ]}
                """);
    }

    private static String rss(String base, int count) {
        StringBuilder xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<rss version=\"2.0\"><channel>");
        for (int index = 1; index <= count; index++) {
            xml.append("<item><title><![CDATA[标题 ").append(index).append(" <b>x</b>]]></title>")
                    .append("<link><![CDATA[").append(base).append(index).append("?utm_source=rss]]></link>")
                    .append("<description><![CDATA[<p>摘要 <b>").append(index).append("</b></p>]]></description>")
                    .append("<pubDate>Wed, 15 Oct 2026 10:00:00 GMT</pubDate></item>");
        }
        return xml.append("</channel></rss>").toString();
    }

    private static Path createDataDir() {
        try {
            return Files.createTempDirectory("kb-briefing-");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** 可拨动的时钟（补抓逻辑要能验证「未到点 / 已过点」）。 */
    static final class MutableClock extends Clock {

        private final ZoneId zone = ZoneId.of("Asia/Shanghai");
        private volatile Instant instant;

        MutableClock(Instant instant) {
            this.instant = instant;
        }

        void set(String isoInstant) {
            this.instant = Instant.parse(isoInstant);
        }

        @Override
        public ZoneId getZone() {
            return zone;
        }

        @Override
        public Clock withZone(ZoneId requested) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }

    /** 只认内存里配置好的样本；会抛异常的源用来模拟单源失败。 */
    static final class FakeHttpTransport implements HttpTransport {

        final Map<String, String> bodies = Collections.synchronizedMap(new LinkedHashMap<>());
        final List<String> failing = Collections.synchronizedList(new ArrayList<>());
        final List<String> requested = Collections.synchronizedList(new ArrayList<>());
        final java.util.concurrent.atomic.AtomicLong gatedAt = new java.util.concurrent.atomic.AtomicLong();
        /** 最小的 PNG 头（够 sniffImageMime 认出是图片）。 */
        static final byte[] PNG_BYTES = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A,
                0, 0, 0, 0x0D, 'I', 'H', 'D', 'R'};
        volatile CountDownLatch gate;
        volatile String gateUrl;

        @Override
        public String get(String url) {
            return get(url, JdkHttpTransport.ACCEPT_HTML);
        }

        @Override
        public byte[] getBytes(String url, java.time.Duration attemptTimeout) {
            requested.add(url);
            if (!bodies.containsKey(url)) {
                throw new BriefingFetchException("HTTP 404（fake 未配置 " + url + "）");
            }
            // 同一个 URL → 同样的字节（sha256 相同）；不同 URL → 不同字节，避免误判为同一张图
            byte[] payload = java.util.Arrays.copyOf(PNG_BYTES, PNG_BYTES.length + 4);
            int hash = url.hashCode();
            payload[PNG_BYTES.length] = (byte) (hash >>> 24);
            payload[PNG_BYTES.length + 1] = (byte) (hash >>> 16);
            payload[PNG_BYTES.length + 2] = (byte) (hash >>> 8);
            payload[PNG_BYTES.length + 3] = (byte) hash;
            return payload;
        }

        @Override
        public String get(String url, String accept) {
            requested.add(url);
            if (gate != null && url.equals(gateUrl)) {
                gatedAt.incrementAndGet();
                try {
                    gate.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            if (failing.stream().anyMatch(failed -> url.equals(failed) || url.startsWith(failed))) {
                throw new BriefingFetchException("HTTP 403（fake）");
            }
            if (url.startsWith("https://api.mymemory.translated.net/") && url.contains("TRANSFAIL")) {
                throw new BriefingFetchException("HTTP 429（fake 限流）");
            }
            String body = bodies.get(url);
            if (body == null) {
                body = bodies.entrySet().stream()
                        .filter(entry -> url.startsWith(entry.getKey()))
                        .map(Map.Entry::getValue)
                        .findFirst()
                        .orElse(null);
            }
            if (body == null) {
                throw new BriefingFetchException("HTTP 404（fake 未配置 " + url + "）");
            }
            return body;
        }
    }
}

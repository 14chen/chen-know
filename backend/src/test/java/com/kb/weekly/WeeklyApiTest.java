package com.kb.weekly;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.kb.briefing.BriefingFetchException;
import com.kb.briefing.HttpTransport;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
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

/** 开源周报端到端（fake 传输层，绝不联网）。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(WeeklyApiTest.FakeConfig.class)
class WeeklyApiTest {

    private static final Path DATA_DIR = createDataDir();
    private static final FakeTransport TRANSPORT = new FakeTransport();
    private static final String TRENDING = """
            <article class="Box-row">
              <h2><a href="/cloudflare/security-audit-skill">x</a></h2>
              <p class="col-9">Audit browser extensions with AI.</p>
              <span itemprop="programmingLanguage">JavaScript</span>
              <a href="/cloudflare/security-audit-skill/stargazers">12,680</a>
              <span>12,680 stars this week</span>
            </article>
            <article class="Box-row">
              <h2><a href="/foo/bar">x</a></h2>
              <p class="col-9">A tiny Go tool.</p>
              <span itemprop="programmingLanguage">Go</span>
              <a href="/foo/bar/stargazers">3241</a>
              <span>3,241 stars this week</span>
            </article>
            <article class="Box-row">
              <h2><a href="/baz/qux">x</a></h2>
              <p class="col-9">Third repo.</p>
              <span itemprop="programmingLanguage">Rust</span>
              <a href="/baz/qux/stargazers">900</a>
              <span>900 stars this week</span>
            </article>
            <article class="Box-row">
              <h2><a href="/four/five">x</a></h2>
              <p class="col-9">Fourth repo.</p>
              <span itemprop="programmingLanguage">Python</span>
              <a href="/four/five/stargazers">800</a>
              <span>800 stars this week</span>
            </article>
            <article class="Box-row">
              <h2><a href="/six/seven">x</a></h2>
              <p class="col-9">Fifth repo.</p>
              <span itemprop="programmingLanguage">TypeScript</span>
              <a href="/six/seven/stargazers">700</a>
              <span>700 stars this week</span>
            </article>
            """;

    private static final String GITEE_JSON = """
            {"fetchedAt":"%s","items":[
              {"repo":"dromara/Sa-Token","stars":49500,"desc":"轻量级 Java 权限认证框架"},
              {"repo":"若依/RuoYi","stars":32000,"desc":"后台管理系统"},
              {"repo":"a/b","stars":100,"desc":"第三个"},
              {"repo":"c/d","stars":90,"desc":"第四个"},
              {"repo":"e/f","stars":80,"desc":"第五个"},
              {"repo":"g/h","stars":70,"desc":"第六个（超出 per-source 不应入榜）"}
            ]}
            """;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
        registry.add("kb.weekly.owner", () -> "demo");
        registry.add("kb.weekly.folder", () -> "开源周报");
        registry.add("kb.weekly.tags", () -> "开源周报");
        registry.add("kb.weekly.per-source", () -> "5");
        registry.add("kb.weekly.gitee-json", () -> giteeFile().toString());
        // 避免真实周五触发
        registry.add("kb.weekly.cron", () -> "0 0 4 * * SUN");
    }

    private static Path giteeFile() {
        return DATA_DIR.resolve("weekly-gitee.json");
    }

    @TestConfiguration
    static class FakeConfig {

        @Bean
        @Primary
        FakeTransport weeklyFakeTransport() {
            return TRANSPORT;
        }
    }

    static final class FakeTransport implements HttpTransport {

        volatile CountDownLatch gate;
        final AtomicLong gated = new AtomicLong();

        @Override
        public String get(String url) {
            return get(url, "text/html");
        }

        @Override
        public String get(String url, String accept) {
            if (gate != null && url.contains("github.com/trending")) {
                gated.incrementAndGet();
                try {
                    gate.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            if (url.contains("github.com/trending")) {
                return TRENDING;
            }
            if (url.startsWith("https://api.github.com/repos/")) {
                return "{\"full_name\":\"x/y\",\"pushed_at\":\"2026-10-24T08:00:00Z\","
                        + "\"open_issues_count\":42,\"forks_count\":7}";
            }
            if (url.startsWith("https://api.mymemory.translated.net/")
                    || url.startsWith("https://api-free.deepl.com/")) {
                return "{\"responseData\":{\"translatedText\":\"用 AI 审计浏览器扩展。\"},"
                        + "\"quotaFinished\":false,\"responseStatus\":200}";
            }
            throw new BriefingFetchException("HTTP 404（fake 未配置 " + url + "）");
        }

        @Override
        public String post(String url, Map<String, String> headers, String body, Duration timeout) {
            throw new BriefingFetchException("HTTP 404（fake 未配置 POST " + url + "）");
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private WeeklyRepository weeklyRepository;

    @Autowired
    private RepoStarSnapshots snapshots;

    @Autowired
    private WeeklyProperties properties;

    @Autowired
    private java.util.concurrent.ExecutorService weeklyExecutor;

    private static MockHttpSession session;
    private static long spaceId;
    private static long userId;

    @BeforeEach
    void setUp() throws Exception {
        if (session == null) {
            mockMvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                            .content(("{\"username\":\"demo\",\"displayName\":\"演示\","
                                    + "\"password\":\"demoPass123\",\"inviteCode\":null}")
                                    .getBytes(StandardCharsets.UTF_8)))
                    .andExpect(status().isCreated());
            MvcResult login = mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"username\":\"demo\",\"password\":\"demoPass123\"}"
                                    .getBytes(StandardCharsets.UTF_8)))
                    .andExpect(status().isOk()).andReturn();
            session = (MockHttpSession) login.getRequest().getSession(false);
            userId = jdbc.queryForObject("SELECT id FROM users WHERE username = ?", Long.class, "demo");
            spaceId = jdbc.queryForObject("SELECT id FROM spaces WHERE owner_id = ?", Long.class, userId);
        }
        // 每次写入新鲜的 Gitee 数据（fetchedAt = 现在，避免被判过期）
        try {
            Files.writeString(giteeFile(), GITEE_JSON.formatted(java.time.Instant.now().toString()),
                    StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        // 排空启动补抓线程，避免它在断言之间插进来
        try {
            weeklyExecutor.submit(() -> {
            }).get(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            Thread.currentThread().interrupt();
        }
        TRANSPORT.gate = null;
        TRANSPORT.gated.set(0);
    }

    @Test
    @DisplayName("GitHub 开放 issue / fork 数落库，成为周报 Top3 的真实活跃度证据")
    void weeklyEngagementIsPersisted() throws Exception {
        jdbc.update("DELETE FROM weekly_project_weeks WHERE space_id = ?", spaceId);
        mockMvc.perform(post("/api/weekly/run").session(session)).andExpect(status().isOk());
        Integer issues = jdbc.queryForObject("SELECT open_issues FROM weekly_project_weeks"
                + " WHERE space_id = ? AND source = 'github' LIMIT 1", Integer.class, spaceId);
        assertEquals(42, issues, "开放 issue 数（含 PR）要落库");
        Integer forks = jdbc.queryForObject("SELECT forks FROM weekly_project_weeks"
                + " WHERE space_id = ? AND source = 'github' LIMIT 1", Integer.class, spaceId);
        assertEquals(7, forks, "fork 数要落库");
    }

    @Test
    @DisplayName("跑一次：10 篇笔记（5 GitHub + 5 Gitee），落在 开源周报/<ISO 周> 下，带标签与仓库地址")
    void runCreatesTenNotes() throws Exception {
        // 先清掉本周已存在的笔记，保证这条用例自己拿到 10 篇新笔记（与其他用例顺序无关）
        jdbc.update("DELETE FROM notes WHERE space_id = ?", spaceId);
        jdbc.update("DELETE FROM note_tags WHERE note_id NOT IN (SELECT id FROM notes)");
        MvcResult result = mockMvc.perform(post("/api/weekly/run").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.notesCreated").value(10))
                .andExpect(jsonPath("$.notes.length()").value(10))
                .andReturn();
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        String isoWeek = body.replaceAll("(?s).*\"isoWeek\":\"([^\"]+)\".*", "$1");

        // 目录结构：开源周报/<ISO 周>
        Long rootId = jdbc.queryForObject("SELECT id FROM folders WHERE space_id = ? AND name = ?"
                + " AND parent_id IS NULL", Long.class, spaceId, "开源周报");
        Long weekId = jdbc.queryForObject("SELECT id FROM folders WHERE space_id = ? AND name = ?"
                + " AND parent_id = ?", Long.class, spaceId, isoWeek, rootId);
        assertNotNull(weekId, "必须有 开源周报/" + isoWeek + " 子目录");
        // 只校验本次运行产出的 10 篇（同一上下文里别的用例可能已经建过笔记）
        List<Long> thisRun = jdbc.queryForList(
                "SELECT id FROM notes WHERE space_id = ? AND folder_id = ? AND deleted_at IS NULL"
                        + " ORDER BY id DESC LIMIT 10", Long.class, spaceId, weekId);
        assertEquals(10, thisRun.size(), "本次运行应有 10 篇落在周目录下");
        Integer inFolder = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notes WHERE folder_id = ? AND deleted_at IS NULL AND id IN ("
                        + thisRun.stream().map(id -> "?").collect(java.util.stream.Collectors.joining(","))
                        + ")", Integer.class,
                java.util.stream.Stream.concat(java.util.stream.Stream.of(weekId), thisRun.stream())
                        .toArray());
        assertEquals(10, inFolder, "10 篇笔记都要落在周目录下");

        // 每篇都有仓库地址 + 标签
        Integer taggedInRun = jdbc.queryForObject(
                "SELECT COUNT(*) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id"
                        + " WHERE t.name = ? AND nt.note_id IN ("
                        + thisRun.stream().map(id -> "?").collect(java.util.stream.Collectors.joining(","))
                        + ")", Integer.class,
                java.util.stream.Stream.concat(java.util.stream.Stream.of("开源周报"), thisRun.stream())
                        .toArray());
        assertEquals(10, taggedInRun, "10 篇都要打上「开源周报」标签");
        List<Map<String, Object>> notes = jdbc.queryForList(
                "SELECT id, title, content FROM notes WHERE folder_id = ? AND id IN ("
                        + thisRun.stream().map(id -> "?").collect(java.util.stream.Collectors.joining(","))
                        + ") ORDER BY id", java.util.stream.Stream.concat(
                        java.util.stream.Stream.of(weekId), thisRun.stream()).toArray());
        for (Map<String, Object> note : notes) {
            String content = String.valueOf(note.get("content"));
            assertTrue(content.contains("| 仓库地址 | https://"), "仓库地址在信息表里: " + content);
            assertTrue(content.contains("| 本周榜位 | 第 "), content);
            if (String.valueOf(note.get("title")).startsWith("[GitHub]")) {
                assertTrue(content.contains("| 最近更新 | 10-24 |"),
                        "GitHub 仓库应通过 API 补上最近更新: " + content);
            }
            String title = String.valueOf(note.get("title"));
            assertTrue(title.startsWith("[GitHub] ") || title.startsWith("[Gitee] "), title);
        }
        // Gitee 中文 owner 的链接要编码
        assertTrue(notes.stream().anyMatch(note -> String.valueOf(note.get("content"))
                        .contains("https://gitee.com/%E8%8B%A5%E4%BE%9D/RuoYi")),
                "中文 owner 必须走编码后的地址");

        // 快照：10 个仓库都写了（可能含别的用例写的，断言「至少 10」+ 具体某仓库存在）
        assertTrue(snapshots.count(spaceId) >= 10, "快照应有 10 个仓库: " + snapshots.count(spaceId));
        assertEquals(java.util.Optional.of(12680L), snapshots.starsAtOrBefore(spaceId, "github",
                "cloudflare/security-audit-skill", "2999-12-31T00:00:00Z"));
        assertTrue(notes.stream().anyMatch(note -> String.valueOf(note.get("content"))
                .contains("首次收录")), "首次收录的源要在推荐理由里说明，而不是写占位");

        // 运行记录：按本次 runId 精确校验（不依赖列表顺序，别的用例可能也在跑）
        long runId = jdbc.queryForObject("SELECT MAX(id) FROM weekly_runs WHERE space_id = ?",
                Long.class, spaceId);
        assertEquals("success", jdbc.queryForObject("SELECT status FROM weekly_runs WHERE id = ?",
                String.class, runId));
        assertEquals(10, jdbc.queryForObject("SELECT notes_created FROM weekly_runs WHERE id = ?",
                Integer.class, runId));
        mockMvc.perform(get("/api/weekly/runs?limit=20").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id == " + runId + ")].status")
                        .value(org.hamcrest.Matchers.hasItem("success")))
                .andExpect(jsonPath("$.items[?(@.id == " + runId + ")].isoWeek")
                        .value(org.hamcrest.Matchers.hasItem(isoWeek)));
        assertTrue(weeklyRepository.hasRunForWeek(spaceId, isoWeek), "本周已跑过 → 启动补抓不会再跑");
    }

    @Test
    @DisplayName("同一 ISO 周再跑一次：不产生重复笔记（notesCreated=0，notesSkipped=10）")
    void secondRunInSameWeekIsIdempotent() throws Exception {
        mockMvc.perform(post("/api/weekly/run").session(session)).andExpect(status().isOk());
        int notesBefore = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL", Integer.class, spaceId);
        mockMvc.perform(post("/api/weekly/run").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notesCreated").value(0))
                .andExpect(jsonPath("$.notesSkipped").value(10));
        // 落库 + 接口返回：前端运行历史表的「跳过」列靠这个字段
        mockMvc.perform(get("/api/weekly/runs?limit=1").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].notesSkipped").value(10));
        assertEquals(10, jdbc.queryForObject(
                "SELECT notes_skipped FROM weekly_runs ORDER BY id DESC LIMIT 1", Integer.class));
        int notesAfter = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL", Integer.class, spaceId);
        assertEquals(notesBefore, notesAfter, "同一周重复运行不得新增笔记");
    }

    @Test
    @DisplayName("Gitee 数据缺失 → 只出 5 篇 GitHub，status=partial，并如实说明未更新")
    void giteeMissingDegrades() throws Exception {
        String original = properties.getGiteeJson();
        try {
            properties.setGiteeJson("data/not-there-" + System.nanoTime() + ".json");
            jdbc.update("DELETE FROM notes WHERE space_id = ?", spaceId);
            jdbc.update("DELETE FROM note_tags WHERE note_id NOT IN (SELECT id FROM notes)");
            mockMvc.perform(post("/api/weekly/run").session(session))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("partial"))
                    .andExpect(jsonPath("$.notesCreated").value(5))
                    .andExpect(jsonPath("$.giteeNote").value(org.hamcrest.Matchers.containsString("未更新")));
        } finally {
            properties.setGiteeJson(original);
        }
    }

    @Test
    @DisplayName("并发保护：同一空间同时只允许一个，第二个 409")
    void concurrentRunConflicts() throws Exception {
        CountDownLatch gate = new CountDownLatch(1);
        TRANSPORT.gate = gate;
        Thread worker = new Thread(() -> {
            try {
                mockMvc.perform(post("/api/weekly/run").session(session));
            } catch (Exception ignored) {
                // 第一个请求的结果不重要
            }
        }, "weekly-concurrent");
        worker.start();
        try {
            long deadline = System.currentTimeMillis() + 10_000;
            while (TRANSPORT.gated.get() == 0 && System.currentTimeMillis() < deadline) {
                Thread.sleep(20);
            }
            mockMvc.perform(post("/api/weekly/run").session(session))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.error.code").value("CONFLICT"));
        } finally {
            gate.countDown();
            worker.join(20_000);
        }
    }

    @Test
    @DisplayName("未登录访问周报接口 → 401")
    void requiresLogin() throws Exception {
        mockMvc.perform(post("/api/weekly/run")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/weekly/runs")).andExpect(status().isUnauthorized());
    }

    private static Path createDataDir() {
        try {
            return Files.createTempDirectory("kb-weekly-");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}

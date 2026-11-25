package com.kb.weekly;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.kb.briefing.BriefingFetchException;
import com.kb.briefing.HttpTransport;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 给入选仓库补 pushed_at：只打入选的、403 熔断、失败静默（全程 fake 传输层）。 */
class GitHubRepoApiTest {

    private static WeeklyRepo repo(String name) {
        return new WeeklyRepo("github", name, "https://github.com/" + name, 1000L, 100, "Go", "desc");
    }

    /** 记录请求次数；可按需返回 pushed_at 或抛错。 */
    private static class FakeTransport implements HttpTransport {

        final AtomicInteger calls = new AtomicInteger();
        final java.util.List<String> urls = new java.util.ArrayList<>();
        String pushedAt = "2026-10-24T08:00:00Z";
        RuntimeException failure;

        @Override
        public String get(String url) {
            return get(url, "application/json");
        }

        @Override
        public String get(String url, String accept) {
            calls.incrementAndGet();
            urls.add(url);
            if (failure != null) {
                throw failure;
            }
            return "{\"full_name\":\"x/y\",\"pushed_at\":\"" + pushedAt + "\","
                    + "\"open_issues_count\":42,\"forks_count\":7}";
        }
    }

    private static GitHubRepoApi api(FakeTransport transport, String base) {
        WeeklyProperties properties = new WeeklyProperties();
        properties.setGithubApiBase(base);
        return new GitHubRepoApi(transport, properties);
    }

    @Test
    @DisplayName("只对入选仓库请求，pushed_at 填进 updatedAt")
    void fillsPushedAt() {
        FakeTransport transport = new FakeTransport();
        List<WeeklyRepo> result = api(transport, "https://api.github.com")
                .withUpdatedAt(List.of(repo("a/b"), repo("c/d")));
        assertEquals(2, transport.calls.get(), "只对入选的两个仓库各请求一次");
        assertEquals("2026-10-24T08:00:00Z", result.get(0).updatedAt());
        assertEquals("2026-10-24T08:00:00Z", result.get(1).updatedAt());
        assertTrue(transport.urls.contains("https://api.github.com/repos/a/b"), transport.urls.toString());
        assertTrue(transport.urls.contains("https://api.github.com/repos/c/d"), transport.urls.toString());
    }

    @Test
    @DisplayName("同一个 /repos 响应顺带取开放 issue 与 fork 数，不额外发请求")
    void capturesEngagementSignals() {
        FakeTransport transport = new FakeTransport();
        List<WeeklyRepo> result = api(transport, "https://api.github.com")
                .withUpdatedAt(List.of(repo("a/b")));
        assertEquals(1, transport.calls.get(), "互动信号必须搭车，不能为它多发请求");
        assertEquals(42, result.get(0).openIssues(), "open_issues_count（含开放 PR）是活跃度信号");
        assertEquals(7, result.get(0).forks(), "forks_count 是真实传播信号");
    }

    @Test
    @DisplayName("已经有 updatedAt 的仓库不再请求")
    void skipsAlreadyKnown() {
        FakeTransport transport = new FakeTransport();
        WeeklyRepo known = new WeeklyRepo("github", "a/b", "https://github.com/a/b", 1L, 1, "Go", "d",
                "2026-10-20");
        List<WeeklyRepo> result = api(transport, "https://api.github.com").withUpdatedAt(List.of(known));
        assertEquals(0, transport.calls.get());
        assertEquals("2026-10-20", result.get(0).updatedAt());
    }

    @Test
    @DisplayName("403/429 → 本轮熔断：只请求一次，其余仓库跳过（省限额）")
    void breaksCircuitOnRateLimit() {
        FakeTransport transport = new FakeTransport();
        transport.failure = new BriefingFetchException("HTTP 403（响应开头：API rate limit exceeded）");
        List<WeeklyRepo> result = api(transport, "https://api.github.com").withUpdatedAt(List.of(
                repo("a/1"), repo("b/2"), repo("c/3"), repo("d/4"), repo("e/5")));
        // 5 个并发里可能已经有 1~2 个在飞行中，但绝不能把 5 个都打出去
        assertTrue(transport.calls.get() <= 2, "遇到 403 后本轮应尽快熔断，实际请求 "
                + transport.calls.get() + " 次");
        assertTrue(result.stream().allMatch(item -> item.updatedAt() == null));
    }

    @Test
    @DisplayName("普通网络失败/坏响应 → 该条为 null，不抛异常、不影响其它仓库")
    void silentDegradation() {
        FakeTransport transport = new FakeTransport();
        transport.failure = new BriefingFetchException("超时 6s 无响应");
        List<WeeklyRepo> result = api(transport, "https://api.github.com")
                .withUpdatedAt(List.of(repo("a/b")));
        assertNull(result.get(0).updatedAt());

        FakeTransport broken = new FakeTransport() {
            @Override
            public String get(String url, String accept) {
                calls.incrementAndGet();
                return "not json";
            }
        };
        assertNull(api(broken, "https://api.github.com").withUpdatedAt(List.of(repo("a/b")))
                .get(0).updatedAt());
    }

    @Test
    @DisplayName("只有 github 源会被请求；gitee 原样返回（它由脚本给 updatedAt）")
    void onlyGitHub() {
        FakeTransport transport = new FakeTransport();
        WeeklyRepo gitee = new WeeklyRepo("gitee", "dromara/Sa-Token", "https://gitee.com/dromara/Sa-Token",
                100L, null, null, "d", null);
        List<WeeklyRepo> result = api(transport, "https://api.github.com").withUpdatedAt(List.of(gitee));
        assertEquals(0, transport.calls.get());
        assertNull(result.get(0).updatedAt());
    }

    @Test
    @DisplayName("可用 kb.weekly.github-api-base 覆盖基址（故障演练用）")
    void baseCanBeOverridden() {
        FakeTransport transport = new FakeTransport();
        api(transport, "http://127.0.0.1:1").withUpdatedAt(List.of(repo("a/b")));
        assertEquals(1, transport.calls.get());
        assertTrue(transport.urls.get(0).startsWith("http://127.0.0.1:1/repos/a/b"), transport.urls.toString());
    }
}

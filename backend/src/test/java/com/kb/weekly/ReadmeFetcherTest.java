package com.kb.weekly;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.kb.briefing.BriefingFetchException;
import com.kb.briefing.HttpTransport;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** README 抓取：候选地址、失败原因、批量顺序 —— 全部用假传输层，绝不联网。 */
class ReadmeFetcherTest {

    private static WeeklyProperties props() {
        return new WeeklyProperties();
    }

    private static WeeklyRepo github(String name) {
        return new WeeklyRepo("github", name, "https://github.com/" + name, 10L, null, "JavaScript", "d", null);
    }

    @Test
    @DisplayName("GitHub：首选 raw.githubusercontent.com 的 HEAD 分支")
    void githubUsesHeadBranch() {
        FakeTransport transport = new FakeTransport();
        transport.bodies.put("https://raw.githubusercontent.com/acme/demo/HEAD/README.md", "# Demo\n");
        ReadmeFetcher.Result result = new ReadmeFetcher(transport, props()).fetch(github("acme/demo"));
        assertTrue(result.ok(), result.reason());
        assertEquals("https://raw.githubusercontent.com/acme/demo/HEAD/README.md", result.url());
    }

    @Test
    @DisplayName("HEAD 404：自动退到 main，再退到 master")
    void fallsBackToMainThenMaster() {
        FakeTransport transport = new FakeTransport();
        transport.failing.add("https://raw.githubusercontent.com/acme/demo/HEAD/README.md");
        transport.failing.add("https://raw.githubusercontent.com/acme/demo/main/README.md");
        transport.bodies.put("https://raw.githubusercontent.com/acme/demo/master/README.md", "# Demo\n");
        ReadmeFetcher.Result result = new ReadmeFetcher(transport, props()).fetch(github("acme/demo"));
        assertTrue(result.ok(), result.reason());
        assertTrue(result.url().endsWith("/master/README.md"), result.url());
    }

    @Test
    @DisplayName("全部失败：返回原因，不返回空字符串冒充成功")
    void allCandidatesFail() {
        FakeTransport transport = new FakeTransport();
        transport.failing.add("https://raw.githubusercontent.com/acme/demo/HEAD/README.md");
        transport.failing.add("https://raw.githubusercontent.com/acme/demo/main/README.md");
        transport.failing.add("https://raw.githubusercontent.com/acme/demo/master/README.md");
        ReadmeFetcher.Result result = new ReadmeFetcher(transport, props()).fetch(github("acme/demo"));
        assertFalse(result.ok());
        assertTrue(result.reason().contains("404"), result.reason());
    }

    @Test
    @DisplayName("Gitee：走 gitee.com/{owner}/{repo}/raw/master/README.md")
    void giteeUsesRawPath() {
        WeeklyRepo repo = new WeeklyRepo("gitee", "mirrors/redis", "https://gitee.com/mirrors/redis", 1L,
                null, "C", "d", null);
        List<String> candidates = ReadmeFetcher.candidates(repo);
        assertEquals("https://gitee.com/mirrors/redis/raw/master/README.md", candidates.get(0));
    }

    @Test
    @DisplayName("取回 HTML 错误页：判定失败，不把网页当 README")
    void rejectsHtmlErrorPage() {
        FakeTransport transport = new FakeTransport();
        for (String url : ReadmeFetcher.candidates(github("acme/demo"))) {
            transport.bodies.put(url, "<!DOCTYPE html><html><body>Just a moment...</body></html>");
        }
        ReadmeFetcher.Result result = new ReadmeFetcher(transport, props()).fetch(github("acme/demo"));
        assertFalse(result.ok());
        assertTrue(result.reason().contains("错误页"), result.reason());
    }

    @Test
    @DisplayName("批量：按 key 返回、单条失败不影响其它、顺序稳定")
    void fetchAllKeepsOrderAndIsolatesFailures() {
        FakeTransport transport = new FakeTransport();
        transport.bodies.put("https://raw.githubusercontent.com/acme/one/HEAD/README.md", "# One\n");
        transport.failing.add("https://raw.githubusercontent.com/acme/two/HEAD/README.md");
        List<WeeklyRepo> repos = List.of(github("acme/one"), github("acme/two"));
        Map<String, ReadmeFetcher.Result> results = new ReadmeFetcher(transport, props()).fetchAll(repos);
        assertEquals(2, results.size());
        List<String> keys = new ArrayList<>(results.keySet());
        assertEquals(ReadmeFetcher.key(repos.get(0)), keys.get(0));
        assertEquals(ReadmeFetcher.key(repos.get(1)), keys.get(1));
        assertTrue(results.get(keys.get(0)).ok());
        assertFalse(results.get(keys.get(1)).ok());
    }

    @Test
    @DisplayName("空列表：不发任何请求")
    void emptyListDoesNothing() {
        FakeTransport transport = new FakeTransport();
        assertTrue(new ReadmeFetcher(transport, props()).fetchAll(List.of()).isEmpty());
        assertTrue(transport.calls.isEmpty(), transport.calls.toString());
    }

    static final class FakeTransport implements HttpTransport {

        final Map<String, String> bodies = new LinkedHashMap<>();
        final Set<String> failing = new HashSet<>();
        final List<String> calls = new ArrayList<>();

        @Override
        public String get(String url) {
            return get(url, "text/plain");
        }

        @Override
        public String get(String url, String accept) {
            calls.add(url);
            if (failing.contains(url)) {
                throw new BriefingFetchException("HTTP 404（fake）");
            }
            String body = bodies.get(url);
            if (body == null) {
                throw new BriefingFetchException("HTTP 404（fake 未配置 " + url + "）");
            }
            return body;
        }
    }
}

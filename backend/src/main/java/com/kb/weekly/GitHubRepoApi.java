package com.kb.weekly;

import com.kb.briefing.BriefingFetchException;
import com.kb.briefing.HttpTransport;
import com.kb.briefing.MiniJson;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 给最终入选的 GitHub 仓库补 {@code pushed_at}（trending 页面里没有逐条更新时间）。
 *
 * <p>约束（都为了不拖慢/搞挂一次周报）：
 * <ul>
 *   <li>只对<b>入选的少数仓库</b>请求，不在解析阶段对 14 条全打</li>
 *   <li>并发 + 总超时 {@link #TOTAL_BUDGET}；单个失败只是没有这一行</li>
 *   <li>未认证额度 60 次/小时：一旦遇到 403/429 就在<b>本轮内熔断</b>，剩下的不再请求</li>
 * </ul>
 */
@Component
public class GitHubRepoApi {

    private static final Logger log = LoggerFactory.getLogger(GitHubRepoApi.class);

    static final String DEFAULT_BASE = "https://api.github.com";
    static final Duration ATTEMPT_TIMEOUT = Duration.ofSeconds(6);
    /** 整体预算：超过就不再等，已经拿到的照用。 */
    static final Duration TOTAL_BUDGET = Duration.ofSeconds(10);
    static final String ACCEPT = "application/vnd.github+json";

    private final HttpTransport transport;
    private final WeeklyProperties properties;

    public GitHubRepoApi(HttpTransport transport, WeeklyProperties properties) {
        this.transport = transport;
        this.properties = properties;
    }

    /** @return 补齐了 {@code updatedAt} 的新列表（顺序不变；失败/限流的就是 null） */
    public List<WeeklyRepo> withUpdatedAt(List<WeeklyRepo> repos) {
        List<WeeklyRepo> targets = repos.stream()
                .filter(repo -> "github".equalsIgnoreCase(repo.source()))
                .filter(repo -> repo.updatedAt() == null || repo.updatedAt().isBlank())
                .toList();
        if (targets.isEmpty()) {
            return repos;
        }
        String base = base();
        AtomicBoolean breaker = new AtomicBoolean(false);
        AtomicInteger requested = new AtomicInteger();
        AtomicInteger filled = new AtomicInteger();
        java.util.Map<String, String> resolved = new java.util.concurrent.ConcurrentHashMap<>();

        // 先探一个：这样一旦撞上 403/429，最多浪费 1 次额度就整轮收手
        WeeklyRepo probe = targets.get(0);
        requested.incrementAndGet();
        try {
            String pushedAt = fetchPushedAt(base, probe.repo());
            if (pushedAt != null) {
                resolved.put(probe.repo(), pushedAt);
                filled.incrementAndGet();
            }
        } catch (RateLimited e) {
            log.info("GitHub API 限流/被拒（{}），本轮不补最近更新（周报照常生成）", e.getMessage());
            log.info("GitHub API 补最近更新: 目标 {} 个，实际请求 {} 次，成功 0 个（已限流，直接放弃）",
                    targets.size(), requested.get());
            return repos;
        } catch (RuntimeException e) {
            log.debug("GitHub API 取 pushed_at 失败: {} ({})", probe.repo(), e.toString());
        }

        List<WeeklyRepo> rest = targets.size() <= 1 ? List.of() : targets.subList(1, targets.size());
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<?>> futures = new ArrayList<>(rest.size());
            for (WeeklyRepo repo : rest) {
                futures.add(pool.submit(() -> {
                    if (breaker.get()) {
                        return;                             // 本轮已限流：不再浪费额度
                    }
                    requested.incrementAndGet();
                    try {
                        String pushedAt = fetchPushedAt(base, repo.repo());
                        if (pushedAt != null) {
                            resolved.put(repo.repo(), pushedAt);
                            filled.incrementAndGet();
                        }
                    } catch (RateLimited e) {
                        breaker.set(true);
                        log.debug("GitHub API 限流/被拒（{}），本轮剩余仓库不再请求", e.getMessage());
                    } catch (RuntimeException e) {
                        log.debug("GitHub API 取 pushed_at 失败: {} ({})", repo.repo(), e.toString());
                    }
                }));
            }
            long deadline = System.currentTimeMillis() + TOTAL_BUDGET.toMillis();
            for (Future<?> future : futures) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) {
                    future.cancel(true);
                    continue;
                }
                try {
                    future.get(remaining, TimeUnit.MILLISECONDS);
                } catch (TimeoutException e) {
                    future.cancel(true);
                } catch (Exception e) {
                    if (e instanceof InterruptedException) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }
        log.info("GitHub API 补最近更新: 目标 {} 个，实际请求 {} 次，成功 {} 个{}", targets.size(),
                requested.get(), filled.get(), breaker.get() ? "（已限流熔断）" : "");
        List<WeeklyRepo> result = new ArrayList<>(repos.size());
        for (WeeklyRepo repo : repos) {
            String updatedAt = resolved.get(repo.repo());
            if (updatedAt == null) {
                result.add(repo);
            } else {
                result.add(new WeeklyRepo(repo.source(), repo.repo(), repo.url(), repo.stars(),
                        repo.weeklyStars(), repo.language(), repo.description(), updatedAt));
            }
        }
        return result;
    }

    /** 403/429 视为限流（本轮熔断）；其它失败只影响这一个仓库。 */
    private static final class RateLimited extends RuntimeException {
        RateLimited(String message) {
            super(message);
        }
    }

    private String fetchPushedAt(String base, String repo) {
        String url = base + "/repos/" + repo;
        String body;
        try {
            body = transport.get(url, ACCEPT, ATTEMPT_TIMEOUT);
        } catch (BriefingFetchException e) {
            String message = e.getMessage() == null ? "" : e.getMessage();
            if (message.contains("HTTP 403") || message.contains("HTTP 429")) {
                throw new RateLimited(message);
            }
            throw e;
        }
        try {
            Map<String, Object> json = MiniJson.asObject(MiniJson.parse(body));
            String pushedAt = MiniJson.string(json.get("pushed_at"));
            if (pushedAt == null || pushedAt.isBlank()) {
                return null;
            }
            log.debug("GitHub API 补 pushed_at: {} → {}", repo, pushedAt);
            return pushedAt.trim();
        } catch (IllegalArgumentException e) {
            log.debug("GitHub API 响应无法解析: {} ({})", repo, e.toString());
            return null;
        }
    }

    /** API 基址：默认 api.github.com，可用 {@code kb.weekly.github-api-base} / 环境变量覆盖（便于故障演练）。 */
    String base() {
        String configured = properties.getGithubApiBase();
        return configured == null || configured.isBlank() ? DEFAULT_BASE : configured.trim();
    }
}

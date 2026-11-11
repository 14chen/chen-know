package com.kb.weekly;

import com.kb.briefing.HttpTransport;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 取仓库 README 原文 —— 周报「傻瓜教程」的唯一素材来源。
 *
 * <p>为什么自己取：GitHub 的 README 在 raw.githubusercontent.com 上是纯文本，比抓仓库页再解析 HTML
 * 稳得多；Gitee 走 raw 路径。**只取 README，不抓别的页面**；取不到就把原因带回去，让教程降级成
 * 「给个地址」，绝不编内容。
 *
 * <p>并发 {@value #CONCURRENCY}、单次超时与总预算可配：周报是后台任务，但一条卡死的 README
 * 也不能拖住整轮。
 */
@Component
public class ReadmeFetcher {

    private static final Logger log = LoggerFactory.getLogger(ReadmeFetcher.class);

    /** 并发：README 是纯文本，4 条同时抓足够，也不至于把本机 TLS 加速器打满。 */
    static final int CONCURRENCY = 4;
    /** 只按 Markdown 取：README.rst/README.txt 在笔记里渲染不成样子。 */
    private static final List<String> GITHUB_BRANCHES = List.of("HEAD", "main", "master");
    private static final List<String> GITEE_BRANCHES = List.of("master", "main");
    private static final String ACCEPT = "text/plain, text/markdown, */*;q=0.8";

    private final HttpTransport transport;
    private final WeeklyProperties properties;

    public ReadmeFetcher(HttpTransport transport, WeeklyProperties properties) {
        this.transport = transport;
        this.properties = properties;
    }

    /** @param reason 失败原因（成功时为 null） */
    public record Result(String url, String markdown, String reason) {

        public boolean ok() {
            return markdown != null && !markdown.isBlank();
        }

        static Result failed(String url, String reason) {
            return new Result(url, null, reason);
        }
    }

    /** 并发抓一批；返回顺序与入参一致（key 用 {@link #key(WeeklyRepo)}）。 */
    public Map<String, Result> fetchAll(List<WeeklyRepo> repos) {
        Map<String, Result> out = new LinkedHashMap<>();
        if (repos == null || repos.isEmpty()) {
            return out;
        }
        long deadline = System.nanoTime() + Duration.ofSeconds(properties.getReadmeBudgetSeconds()).toNanos();
        ExecutorService pool = Executors.newFixedThreadPool(Math.min(CONCURRENCY, repos.size()), runnable -> {
            Thread thread = new Thread(runnable, "weekly-readme");
            thread.setDaemon(true);
            return thread;
        });
        try {
            Map<String, Future<Result>> futures = new LinkedHashMap<>();
            for (WeeklyRepo repo : repos) {
                futures.put(key(repo), pool.submit(() -> fetch(repo)));
            }
            for (Map.Entry<String, Future<Result>> entry : futures.entrySet()) {
                out.put(entry.getKey(), await(entry.getValue(), deadline));
            }
        } finally {
            pool.shutdownNow();
        }
        return out;
    }

    private Result await(Future<Result> future, long deadlineNanos) {
        long leftMillis = TimeUnit.NANOSECONDS.toMillis(deadlineNanos - System.nanoTime());
        if (leftMillis <= 0) {
            future.cancel(true);
            return Result.failed(null, "抓取超时（总预算 " + properties.getReadmeBudgetSeconds() + "s 已用完）");
        }
        try {
            return future.get(leftMillis, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            return Result.failed(null, "抓取超时（总预算 " + properties.getReadmeBudgetSeconds() + "s）");
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            return Result.failed(null, "抓取失败：" + describe(cause));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Result.failed(null, "抓取被中断");
        }
    }

    /** 单仓库：按候选地址逐个试，第一个像 README 的就用。 */
    public Result fetch(WeeklyRepo repo) {
        List<String> candidates = candidates(repo);
        if (candidates.isEmpty()) {
            return Result.failed(repo == null ? null : repo.url(), "仓库名不是 owner/name 形式，无法拼 README 地址");
        }
        Duration timeout = Duration.ofSeconds(properties.getReadmeTimeoutSeconds());
        String reason = null;
        String url = candidates.get(0);
        for (String candidate : candidates) {
            url = candidate;
            try {
                String body = transport.get(candidate, ACCEPT, timeout);
                if (body == null || body.isBlank()) {
                    reason = "README 是空的";
                    continue;
                }
                if (looksLikeErrorPage(body)) {
                    reason = "取回的是错误页（不是 README）";
                    continue;
                }
                String markdown = body.length() > properties.getReadmeMaxChars()
                        ? body.substring(0, properties.getReadmeMaxChars())
                        : body;
                return new Result(candidate, markdown, null);
            } catch (RuntimeException e) {
                reason = describe(e);
                log.debug("README 取不到 {}: {}", candidate, reason);
            }
        }
        return Result.failed(url, reason == null ? "没有可用的 README 地址" : reason);
    }

    /** 候选地址：GitHub 用 raw 分支 HEAD/main/master，Gitee 用 raw master/main。 */
    static List<String> candidates(WeeklyRepo repo) {
        List<String> out = new ArrayList<>();
        if (repo == null) {
            return out;
        }
        String path = repoPath(repo);
        if (path == null) {
            return out;
        }
        boolean gitee = "gitee".equalsIgnoreCase(repo.source())
                || (repo.url() != null && repo.url().toLowerCase(Locale.ROOT).contains("gitee.com"));
        if (gitee) {
            for (String branch : GITEE_BRANCHES) {
                out.add("https://gitee.com/" + path + "/raw/" + branch + "/README.md");
            }
        } else {
            for (String branch : GITHUB_BRANCHES) {
                out.add("https://raw.githubusercontent.com/" + path + "/" + branch + "/README.md");
            }
        }
        return out;
    }

    /** owner/name：优先用 repo()，不像就从 url 里抠。 */
    static String repoPath(WeeklyRepo repo) {
        String name = repo.repo();
        if (name != null && name.matches("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")) {
            return name;
        }
        String url = repo.url();
        if (url == null) {
            return null;
        }
        String trimmed = url.trim().replaceAll("/+$", "").replaceAll("\\.git$", "");
        int index = trimmed.indexOf("://");
        String afterHost = index < 0 ? trimmed : trimmed.substring(index + 3);
        int slash = afterHost.indexOf('/');
        if (slash < 0) {
            return null;
        }
        String path = afterHost.substring(slash + 1);
        return path.matches("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+") ? path : null;
    }

    /** map 的 key：同一个仓库跨源不撞车。 */
    public static String key(WeeklyRepo repo) {
        if (repo == null) {
            return "";
        }
        return (repo.source() == null ? "" : repo.source()) + "|" + (repo.repo() == null ? "" : repo.repo());
    }

    /** 404/真人验证页的情况：几百字节的 HTML，不是 README。 */
    private static boolean looksLikeErrorPage(String body) {
        String head = body.substring(0, Math.min(body.length(), 400)).trim().toLowerCase(Locale.ROOT);
        return head.startsWith("<!doctype html") || head.startsWith("<html");
    }

    private static String describe(Throwable error) {
        if (error == null) {
            return "未知原因";
        }
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }
}

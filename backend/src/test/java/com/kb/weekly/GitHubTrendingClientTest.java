package com.kb.weekly;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** GitHub 趋势页解析（固定样本，绝不联网）。 */
class GitHubTrendingClientTest {

    private static final String HTML = """
            <div>
            <article class="Box-row">
              <h2 class="h3 lh-condensed">
                <a href="/cloudflare/security-audit-skill" class="Link">
                  <span> cloudflare / </span><span>security-audit-skill</span>
                </a>
              </h2>
              <p class="col-9 color-fg-muted my-1 pr-4">
                An AI skill for auditing browser extensions.
              </p>
              <span itemprop="programmingLanguage">JavaScript</span>
              <a href="/cloudflare/security-audit-skill/stargazers" data-view-component="true"
                 class="tmp-mr-3 Link Link--muted d-inline-block">
                <svg aria-label="star" role="img" height="16" width="16" class="octicon octicon-star"></svg>
                46,184
              </a>
              <span class="d-inline-block float-sm-right">12,680 stars this week</span>
              <relative-time datetime="2026-10-24T08:00:00Z" class="no-wrap">on Oct 24</relative-time>
            </article>
            <article class="Box-row">
              <h2><a href="/foo/bar">bar</a></h2>
              <p class="col-9">A tiny tool.</p>
              <span itemprop="programmingLanguage">Go</span>
              <a href="/foo/bar/stargazers">3241</a>
              <span>3,241 stars this week</span>
            </article>
            <article class="Box-row">
              <h2><a href="/no/weekly-missing">weekly-missing</a></h2>
              <p class="col-9">No weekly number.</p>
            </article>
            </div>
            """;

    @Test
    @DisplayName("解析仓库、本周新增（含千分位）、语言、描述、总星")
    void parsesTrending() {
        List<WeeklyRepo> repos = GitHubTrendingClient.parse(HTML);
        assertEquals(3, repos.size());
        WeeklyRepo first = repos.get(0);
        assertEquals("cloudflare/security-audit-skill", first.repo());
        assertEquals("https://github.com/cloudflare/security-audit-skill", first.url());
        assertEquals(12680, first.weeklyStars());
        assertEquals(46184L, first.stars(), "总星要能从 svg 后面的数字里解析出来");
        assertEquals("2026-10-24T08:00:00Z", first.updatedAt(), "relative-time 的 datetime 要解析出来");
        assertEquals("JavaScript", first.language());
        assertEquals("An AI skill for auditing browser extensions.", first.description());
        assertEquals("github", first.source());
    }

    @Test
    @DisplayName("没有「stars this week」时周增为 null（渲染成「—」，绝不编造）")
    void missingWeeklyIsNull() {
        List<WeeklyRepo> repos = GitHubTrendingClient.parse(HTML);
        WeeklyRepo last = repos.stream().filter(repo -> repo.repo().equals("no/weekly-missing"))
                .findFirst().orElseThrow();
        assertNull(last.weeklyStars());
        assertNull(last.updatedAt(), "没有 relative-time 时 updatedAt 必须为 null（渲染时整行省略）");
        assertEquals(0L, last.stars());
    }

    @Test
    @DisplayName("解析不到条目时返回空列表（由上层降级，不抛）")
    void emptyWhenNoArticles() {
        assertTrue(GitHubTrendingClient.parse("<html><body>nothing</body></html>").isEmpty());
        assertTrue(GitHubTrendingClient.parse(null).isEmpty());
    }
}

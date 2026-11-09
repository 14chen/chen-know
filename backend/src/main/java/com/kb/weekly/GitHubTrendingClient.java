package com.kb.weekly;

import com.kb.briefing.BriefingText;
import com.kb.briefing.BriefingUrls;
import com.kb.briefing.HttpTransport;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * GitHub 周趋势：{@code https://github.com/trending?since=weekly}（HTML，619 KB）。
 *
 * <p>用正则解析 {@code <article class="Box-row">}：仓库链接 {@code /owner/repo}、
 * 「N stars this week」里的本周新增、语言、描述。纯函数解析，便于单测。
 */
@Component
public class GitHubTrendingClient {

    private static final Logger log = LoggerFactory.getLogger(GitHubTrendingClient.class);

    static final String URL = "https://github.com/trending?since=weekly";
    /** 单次尝试 30s，失败由 transport 自动重试（最多 3 次）。 */
    static final Duration TIMEOUT = Duration.ofSeconds(30);
    static final String ACCEPT_HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

    private static final Pattern ARTICLE = Pattern.compile(
            "<article[^>]*class=\"[^\"]*Box-row[^\"]*\"[^>]*>(.*?)</article>", Pattern.CASE_INSENSITIVE
                    | Pattern.DOTALL);
    private static final Pattern REPO_LINK = Pattern.compile("<h2[^>]*>\\s*<a[^>]*href=\"/([^/\"]+)/([^/\"?#]+)\"",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern WEEKLY = Pattern.compile("([\\d,]+)\\s*stars?\\s+this\\s+week",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern LANGUAGE = Pattern.compile(
            "itemprop=\"programmingLanguage\">([^<]+)</span>", Pattern.CASE_INSENSITIVE);
    private static final Pattern DESCRIPTION = Pattern.compile("<p[^>]*class=\"[^\"]*col-9[^\"]*\"[^>]*>(.*?)</p>",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    /**
     * 总星：{@code <a href="/owner/repo/stargazers" ...><svg …/></svg> 46,184</a>}
     * —— 数字在 svg 之后，所以先取整个锚点再抽数字。
     */
    /** 最近更新时间：{@code <relative-time ... datetime="2026-10-24T…">} */
    private static final Pattern RELATIVE_TIME = Pattern.compile(
            "<relative-time[^>]*datetime=\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);

    private static final Pattern STARGAZERS = Pattern.compile(
            "href=\"[^\"]*/stargazers\"[^>]*>(.*?)</a>",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern NUMBER = Pattern.compile("([\\d,]+)");

    private final HttpTransport transport;

    public GitHubTrendingClient(HttpTransport transport) {
        this.transport = transport;
    }

    /** 抓取并按「本周新增」降序返回（解析不到就抛，交给上层降级）。 */
    public List<WeeklyRepo> fetchTrending() {
        String html = transport.get(URL, ACCEPT_HTML, TIMEOUT);
        List<WeeklyRepo> repos = parse(html);
        if (repos.isEmpty()) {
            log.warn("GitHub 趋势页解析出 0 条（页面结构可能变了）");
        }
        // 按本周新增降序（null 排最后），再按仓库名保证稳定
        return repos.stream()
                .sorted(Comparator
                        .comparingInt((WeeklyRepo repo) -> repo.weeklyStars() == null ? -1 : repo.weeklyStars())
                        .reversed()
                        .thenComparing(WeeklyRepo::repo))
                .toList();
    }

    /** 纯解析：不排序（排序在 {@link #fetchTrending()}）。 */
    public static List<WeeklyRepo> parse(String html) {
        List<WeeklyRepo> repos = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        Matcher article = ARTICLE.matcher(html == null ? "" : html);
        while (article.find()) {
            String block = article.group(1);
            Matcher link = REPO_LINK.matcher(block);
            if (!link.find()) {
                continue;
            }
            String owner = link.group(1);
            String name = link.group(2);
            String repo = owner + "/" + name;
            if (!seen.add(repo)) {
                continue;
            }
            Integer weekly = null;
            Matcher weeklyMatcher = WEEKLY.matcher(block);
            if (weeklyMatcher.find()) {
                weekly = Integer.valueOf(weeklyMatcher.group(1).replace(",", ""));
            }
            String language = null;
            Matcher languageMatcher = LANGUAGE.matcher(block);
            if (languageMatcher.find()) {
                language = languageMatcher.group(1).trim();
            }
            String description = null;
            Matcher descriptionMatcher = DESCRIPTION.matcher(block);
            if (descriptionMatcher.find()) {
                description = BriefingText.collapse(BriefingText.stripHtml(descriptionMatcher.group(1)));
                if (description.isEmpty()) {
                    description = null;
                }
            }
            String url = "https://github.com/" + repo;
            if (!BriefingUrls.isPublicHttpUrl(url)) {
                continue;
            }
            long totalStars = 0L;
            Matcher starMatcher = STARGAZERS.matcher(block);
            if (starMatcher.find()) {
                String text = BriefingText.stripHtml(starMatcher.group(1));
                Matcher number = NUMBER.matcher(text);
                String last = null;
                while (number.find()) {
                    last = number.group(1);
                }
                if (last != null) {
                    totalStars = Long.parseLong(last.replace(",", ""));
                }
            }
            String updatedAt = null;
            Matcher timeMatcher = RELATIVE_TIME.matcher(block);
            if (timeMatcher.find()) {
                updatedAt = timeMatcher.group(1).trim();
            }
            repos.add(new WeeklyRepo("github", repo, url, totalStars, weekly, language, description,
                    updatedAt));
        }
        return repos;
    }
}

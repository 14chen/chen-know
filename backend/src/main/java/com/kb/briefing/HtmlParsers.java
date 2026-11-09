package com.kb.briefing;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * BRIEFING.md §1：HTML 列表页的逐源解析规则（Anthropic / arXiv / 机器之心 + Techmeme 的原文链接提取）。
 *
 * <p>契约禁止引入新的解析依赖，因此用锚点正则；每源的规则单独放，页面改版时只动这里。
 */
public final class HtmlParsers {

    /** 机器之心的 /rss 实测返回 HTML 页面而不是 RSS，所以按列表页解析（可选源）。 */
    /** arXiv 的 /abs/ 链接（可能带版本号）。 */
    private static final Pattern ARXIV_ABS = Pattern.compile("href\\s*=\\s*\"/abs/(\\d{4}\\.\\d{4,5})(?:v\\d+)?\"");

    private static final Pattern ANCHOR = Pattern.compile(
            "<a\\b[^>]*?href\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>(.*?)</a>",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private HtmlParsers() {
    }

    /** 从一段 HTML 里按路径前缀挑链接，标题取锚点内文本。 */
    static List<RawItem> anchors(String html, int limit, BriefingSource source, String baseUrl,
            Set<String> skipTextPrefixes, String... pathMarkers) {
        List<RawItem> items = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        Matcher matcher = ANCHOR.matcher(html == null ? "" : html);
        while (matcher.find() && items.size() < limit) {
            String href = matcher.group(1).trim();
            boolean matchesMarker = false;
            for (String marker : pathMarkers) {
                if (href.startsWith(marker) || href.startsWith(baseUrl + marker)
                        || href.contains(marker)) {
                    matchesMarker = true;
                    break;
                }
            }
            if (!matchesMarker) {
                continue;
            }
            String title = BriefingText.clean(matcher.group(2));
            if (title.length() < 4) {
                continue;
            }
            String lower = title.toLowerCase(Locale.ROOT);
            if (skipTextPrefixes.stream().anyMatch(lower::startsWith)) {
                continue;
            }
            String absolute = href.startsWith("http") ? href : baseUrl + href;
            String normalized = BriefingUrls.normalize(absolute);
            if (!seen.add(normalized)) {
                continue;
            }
            items.add(new RawItem(title, absolute, "", source.id(), null, ""));
        }
        if (items.isEmpty()) {
            throw new BriefingFetchException("0 条（页面结构可能变化）");
        }
        return items;
    }

    /** anthropic.com/news：条目链接形如 {@code /news/xxx}，锚点内是卡片文本。 */
    public static List<RawItem> anthropic(String html, int limit, BriefingSource source) {
        return anchors(html, limit, source, "https://www.anthropic.com", Set.of("read more"), "/news/");
    }

    /**
     * arxiv.org/list/cs.AI/recent：条目链接形如 {@code /abs/2510.01234v1}，但**标题不在锚点里**
     * —— 锚点文本是 "arXiv:2510.01234"，真标题在后面的 {@code <div class="list-title">…Title: …</div>}。
     */
    public static List<RawItem> arxiv(String html, int limit, BriefingSource source) {
        List<RawItem> items = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        Matcher matcher = ARXIV_ABS.matcher(html == null ? "" : html);
        while (matcher.find() && items.size() < limit) {
            String id = matcher.group(1);
            String url = "https://arxiv.org/abs/" + id;
            if (!seen.add(BriefingUrls.normalize(url))) {
                continue;
            }
            String title = arxivTitleAfter(html, matcher.end());
            if (title.isEmpty() || title.length() < 8) {
                continue;
            }
            items.add(new RawItem(title, url, "", source.id(), null, ""));
        }
        if (items.isEmpty()) {
            throw new BriefingFetchException("0 条（页面结构可能变化）");
        }
        return items;
    }

    /** 取锚点之后最近一个 list-title 块里的标题文本。 */
    static String arxivTitleAfter(String html, int from) {
        int start = html.indexOf("list-title", from);
        if (start < 0) {
            return "";
        }
        int end = html.indexOf("</div>", start);
        String block = end < 0 ? html.substring(start) : html.substring(start, end);
        int colon = block.indexOf("Title:");
        String raw = colon < 0 ? block : block.substring(colon + "Title:".length());
        return BriefingText.clean(raw);
    }

    /**
     * 机器之心：实测首页是 JS 渲染的，文章链接形如 {@code /short_urls/<uuid>}（跳转到 /articles/...）；
     * 部分页面则直接给 {@code /articles/...}。两种都收。
     */
    public static List<RawItem> jiqizhixin(String html, int limit, BriefingSource source) {
        return anchors(html, limit, source, "https://www.jiqizhixin.com", Set.of("更多"),
                "/short_urls/", "/articles/");
    }

    /** Techmeme：description 的 HTML 里第一个指向站外的链接就是原文。 */
    public static String techmemeArticleLink(String descriptionHtml) {
        if (descriptionHtml == null || descriptionHtml.isEmpty()) {
            return null;
        }
        Matcher matcher = ANCHOR.matcher(descriptionHtml);
        while (matcher.find()) {
            String href = matcher.group(1).trim();
            if (!BriefingUrls.isHttpUrl(href)) {
                continue;
            }
            String lower = href.toLowerCase(Locale.ROOT);
            if (lower.contains("techmeme.com")) {
                continue;
            }
            return href;
        }
        return null;
    }
}

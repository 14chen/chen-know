package com.kb.briefing;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** BRIEFING.md §1 #7：Hacker News（Algolia JSON，只有 JSON 形态的源）。 */
public class HackerNewsFetcher implements BriefingFetcher {

    /** 只给热度最高的少数故事抓原话，避免 N 条故事 = N 次额外请求。 */
    static final int TOP_COMMENT_LIMIT = 3;
    static final int QUOTE_LIMIT = 160;

    private final BriefingSource source;
    private final HttpTransport transport;

    public HackerNewsFetcher(BriefingSource source, HttpTransport transport) {
        this.source = source;
        this.transport = transport;
    }

    @Override
    public BriefingSource source() {
        return source;
    }

    @Override
    public List<RawItem> fetch(int limit) {
        // 7 天时间窗：Algolia 的 search 默认按相关性排序，不加过滤会反复收录旧热帖
        long sinceEpoch = java.time.Instant.now().minus(java.time.Duration.ofDays(7)).getEpochSecond();
        String url = source.url() + "&hitsPerPage=" + Math.max(1, Math.min(limit, 50))
                + "&numericFilters=" + java.net.URLEncoder.encode("created_at_i>" + sinceEpoch,
                        java.nio.charset.StandardCharsets.UTF_8);
        String body = transport.get(url, JdkHttpTransport.ACCEPT_JSON,
                BriefingSources.attemptTimeout(source.id()));
        Object parsed;
        try {
            parsed = MiniJson.parse(body);
        } catch (IllegalArgumentException e) {
            throw new BriefingFetchException("解析失败：" + e.getMessage());
        }
        List<Object> hits = MiniJson.asArray(MiniJson.asObject(parsed).get("hits"));
        List<RawItem> items = new ArrayList<>();
        List<String> objectIds = new ArrayList<>();
        for (Object hit : hits) {
            if (items.size() >= limit) {
                break;
            }
            Map<String, Object> row = MiniJson.asObject(hit);
            String title = BriefingText.clean(MiniJson.string(row.get("title")));
            String link = MiniJson.string(row.get("url"));
            if (link == null || link.isBlank()) {
                String objectId = MiniJson.string(row.get("objectID"));
                link = objectId == null ? null : "https://news.ycombinator.com/item?id=" + objectId;
            }
            if (title.isEmpty() || link == null || !BriefingUrls.isHttpUrl(link)) {
                continue;
            }
            items.add(new RawItem(title, link.trim(), "", source.id(), MiniJson.integer(row.get("points")),
                    MiniJson.string(row.get("created_at")), MiniJson.integer(row.get("num_comments"))));
            objectIds.add(MiniJson.string(row.get("objectID")));
        }
        if (items.isEmpty()) {
            throw new BriefingFetchException("0 条（JSON 里没有可用 hits）");
        }
        attachTopComments(items, objectIds);
        return items;
    }

    /** 给热度最高的几条补高赞原话；任何失败都静默跳过，不影响条目本身。 */
    private void attachTopComments(List<RawItem> items, List<String> objectIds) {
        String itemsBase = itemsEndpoint(source.url());
        if (itemsBase == null) {
            return;
        }
        List<Integer> order = new ArrayList<>();
        for (int index = 0; index < items.size(); index++) {
            order.add(index);
        }
        order.sort((a, b) -> Integer.compare(score(items.get(b)), score(items.get(a))));
        int targets = Math.min(TOP_COMMENT_LIMIT, order.size());
        for (int rank = 0; rank < targets; rank++) {
            int index = order.get(rank);
            String objectId = objectIds.get(index);
            if (objectId == null || objectId.isBlank()) {
                continue;
            }
            String quote = null;
            try {
                String body = transport.get(itemsBase + objectId, JdkHttpTransport.ACCEPT_JSON,
                        BriefingSources.attemptTimeout(source.id()));
                quote = extractTopComment(body);
            } catch (RuntimeException ignored) {
                // 原话是加分项，抓不到就整段省略
            }
            if (quote != null) {
                RawItem raw = items.get(index);
                items.set(index, new RawItem(raw.title(), raw.url(), raw.summary(), raw.source(), raw.score(),
                        raw.publishedAt(), raw.comments(), quote));
            }
        }
    }

    private static int score(RawItem item) {
        return item.score() == null ? 0 : item.score();
    }

    /** Algolia 搜索端点 → 同域的 items 端点。 */
    private static String itemsEndpoint(String searchUrl) {
        int marker = searchUrl.indexOf("/api/v1/");
        return marker < 0 ? null : searchUrl.substring(0, marker) + "/api/v1/items/";
    }

    /** 从 children 里挑 points 最高的一条文本，去标签并截断。 */
    private static String extractTopComment(String body) {
        Map<String, Object> json = MiniJson.asObject(MiniJson.parse(body));
        List<Object> children = MiniJson.asArray(json.get("children"));
        String best = null;
        int bestPoints = -1;
        for (Object child : children) {
            Map<String, Object> row = MiniJson.asObject(child);
            String text = MiniJson.string(row.get("text"));
            if (text == null || text.isBlank()) {
                continue;
            }
            Integer points = MiniJson.integer(row.get("points"));
            int value = points == null ? 0 : points;
            if (value > bestPoints) {
                bestPoints = value;
                best = text;
            }
        }
        return best == null ? null : BriefingText.truncate(BriefingText.clean(best), QUOTE_LIMIT);
    }
}

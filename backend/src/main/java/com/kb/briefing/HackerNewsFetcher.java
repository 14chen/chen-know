package com.kb.briefing;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** BRIEFING.md §1 #7：Hacker News（Algolia JSON，只有 JSON 形态的源）。 */
public class HackerNewsFetcher implements BriefingFetcher {

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
        String url = source.url() + "&hitsPerPage=" + Math.max(1, Math.min(limit, 50));
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
                    MiniJson.string(row.get("created_at"))));
        }
        if (items.isEmpty()) {
            throw new BriefingFetchException("0 条（JSON 里没有可用 hits）");
        }
        return items;
    }
}

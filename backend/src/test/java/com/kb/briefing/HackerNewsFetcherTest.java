package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** HN Algolia JSON 解析（固定样本 + fake 传输层）。 */
class HackerNewsFetcherTest {

    @Test
    @DisplayName("取 title / url / points / created_at；无 url 时回落到 HN 讨论页")
    void parsesHits() {
        String json = """
                {"hits":[
                  {"objectID":"1","title":"AI story","url":"https://example.com/a","points":128,
                   "created_at":"2026-10-15T10:00:00Z"},
                  {"objectID":"2","title":"Ask HN","url":null,"points":7,"created_at":"2026-10-15T11:00:00Z"}
                ],"nbHits":2}
                """;
        HackerNewsFetcher fetcher = new HackerNewsFetcher(BriefingSources.byId("hackernews"),
                new HttpTransport() {
                    @Override
                    public String get(String url) {
                        return get(url, "application/json");
                    }

                    @Override
                    public String get(String url, String accept) {
                        if (url.contains("/items/")) {
                            return "{\"children\":[]}";
                        }
                        assertTrue(url.contains("hitsPerPage="), "limit 要传给 Algolia");
                        assertTrue(url.contains("numericFilters=") && url.contains("created_at_i%3E"),
                                "必须带 7 天时间窗，避免反复收录旧热帖: " + url);
                        return json;
                    }
                });
        List<RawItem> items = fetcher.fetch(5);
        assertEquals(2, items.size());
        assertEquals("AI story", items.get(0).title());
        assertEquals(128, items.get(0).score());
        assertEquals("https://news.ycombinator.com/item?id=2", items.get(1).url());
    }

    @Test
    @DisplayName("取 num_comments 作为互动信号；缺字段时为 null")
    void parsesComments() {
        String json = """
                {"hits":[
                  {"objectID":"1","title":"Hot","url":"https://example.com/hot","points":128,
                   "num_comments":36,"created_at":"2026-10-15T10:00:00Z"},
                  {"objectID":"2","title":"Cold","url":"https://example.com/cold","points":2,
                   "created_at":"2026-10-15T11:00:00Z"}
                ],"nbHits":2}
                """;
        HackerNewsFetcher fetcher = new HackerNewsFetcher(BriefingSources.byId("hackernews"),
                FakeTransport.body(json));
        List<RawItem> items = fetcher.fetch(5);
        assertEquals(36, items.get(0).comments(), "HN 评论数是真实互动信号");
        org.junit.jupiter.api.Assertions.assertNull(items.get(1).comments(), "缺 num_comments 时为 null");
    }

    @Test
    @DisplayName("为热度最高的少数故事抓高赞原话，剥掉 HTML；失败静默降级")
    void fetchesTopComment() {
        String search = """
                {"hits":[
                  {"objectID":"1","title":"Hot","url":"https://example.com/hot","points":128,
                   "num_comments":36,"created_at":"2026-10-15T10:00:00Z"},
                  {"objectID":"2","title":"Warm","url":"https://example.com/warm","points":90,
                   "num_comments":4,"created_at":"2026-10-15T11:00:00Z"}
                ],"nbHits":2}
                """;
        String item1 = """
                {"id":1,"children":[
                  {"author":"alice","points":127,"text":"<p>这是高赞原话</p>"},
                  {"author":"bob","points":5,"text":"低赞评论"}
                ]}
                """;
        java.util.List<String> fetched = new java.util.ArrayList<>();
        HackerNewsFetcher fetcher = new HackerNewsFetcher(BriefingSources.byId("hackernews"),
                new HttpTransport() {
                    @Override
                    public String get(String url) {
                        return get(url, "application/json");
                    }

                    @Override
                    public String get(String url, String accept) {
                        fetched.add(url);
                        if (url.contains("/items/1")) return item1;
                        if (url.contains("/items/2")) throw new BriefingFetchException("HTTP 500（fake）");
                        return search;
                    }
                });
        List<RawItem> items = fetcher.fetch(5);
        assertEquals("这是高赞原话", items.get(0).topComment(), "高赞原话要剥掉 HTML");
        org.junit.jupiter.api.Assertions.assertNull(items.get(1).topComment(), "失败不阻断，只是没有原话");
        assertEquals(3, fetched.size(), "搜索 1 次 + 最多 2 个故事各 1 次");
    }

    @Test
    @DisplayName("空 hits → 具体原因")
    void reportsEmpty() {
        HackerNewsFetcher fetcher = new HackerNewsFetcher(BriefingSources.byId("hackernews"),
                FakeTransport.body("{\"hits\":[]}"));
        assertThrows(BriefingFetchException.class, () -> fetcher.fetch(5));
    }

    @Test
    @DisplayName("坏 JSON → 解析失败")
    void reportsBrokenJson() {
        HackerNewsFetcher fetcher = new HackerNewsFetcher(BriefingSources.byId("hackernews"),
                FakeTransport.body("not json"));
        BriefingFetchException error = assertThrows(BriefingFetchException.class, () -> fetcher.fetch(5));
        assertTrue(error.getMessage().startsWith("解析失败"), error.getMessage());
    }
}

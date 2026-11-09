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
                        assertTrue(url.contains("hitsPerPage="), "limit 要传给 Algolia");
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

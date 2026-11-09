package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** RSS/Atom 解析：用固定样本，绝不联网（HttpTransport 用 fake）。 */
class RssFetcherTest {

    private static final BriefingSource OPENAI = BriefingSources.byId("openai");

    private static RssFetcher fetcher(HttpTransport transport) {
        return new RssFetcher(OPENAI, transport, new SecureXml(), null);
    }

    @Test
    @DisplayName("CDATA 标题 + 富文本 description + pubDate")
    void parsesRssWithCdata() {
        String xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <rss version="2.0"><channel>
                  <item>
                    <title><![CDATA[Introducing <b>GPT-5</b>]]></title>
                    <link><![CDATA[https://openai.com/news/gpt-5?utm_source=rss]]></link>
                    <description><![CDATA[<p>摘要 <b>加粗</b> 内容</p>]]></description>
                    <pubDate>Wed, 15 Oct 2026 10:00:00 GMT</pubDate>
                  </item>
                  <item>
                    <title>Second</title><link>https://openai.com/news/second</link>
                    <description>plain</description>
                  </item>
                </channel></rss>
                """;
        List<RawItem> items = fetcher(FakeTransport.body(xml)).fetch(5);
        assertEquals(2, items.size());
        assertEquals("Introducing GPT-5", items.get(0).title(), "标题要去掉 HTML 标签");
        assertEquals("https://openai.com/news/gpt-5?utm_source=rss", items.get(0).url());
        assertTrue(items.get(0).summary().contains("<p>"), "摘要保持原文，由渲染层去标签");
        assertEquals("openai", items.get(0).source());
        assertEquals("Wed, 15 Oct 2026 10:00:00 GMT", items.get(0).publishedAt());
    }

    @Test
    @DisplayName("Atom 的 <entry>/<link href> 也能解析")
    void parsesAtom() {
        String xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <feed xmlns="http://www.w3.org/2005/Atom">
                  <entry>
                    <title>Atom 标题</title>
                    <link rel="alternate" href="https://deepmind.google/blog/x"/>
                    <summary>atom 摘要</summary>
                    <updated>2026-10-15T10:00:00Z</updated>
                  </entry>
                </feed>
                """;
        List<RawItem> items = fetcher(FakeTransport.body(xml)).fetch(5);
        assertEquals(1, items.size());
        assertEquals("Atom 标题", items.get(0).title());
        assertEquals("https://deepmind.google/blog/x", items.get(0).url());
        assertEquals("atom 摘要", items.get(0).summary());
    }

    @Test
    @DisplayName("Techmeme：从 description 里提取真实原文链接")
    void extractsTechmemeArticleLink() {
        String description = "<p><a href=\"https://www.techmeme.com/251015/p1\">Techmeme</a> "
                + "<a href=\"https://example.com/real-story\">Real story</a></p>";
        assertEquals("https://example.com/real-story", HtmlParsers.techmemeArticleLink(description));
        RssFetcher techmeme = new RssFetcher(BriefingSources.byId("techmeme"), FakeTransport.body("""
                <rss><channel><item><title>Story</title>
                <link>https://www.techmeme.com/251015/p1</link>
                <description><![CDATA[%s]]></description></item></channel></rss>
                """.formatted(description)), new SecureXml(), HtmlParsers::techmemeArticleLink);
        List<RawItem> items = techmeme.fetch(1);
        assertEquals("https://example.com/real-story", items.get(0).url(), "必须跳到原文，而不是 techmeme 自己");
    }

    @Test
    @DisplayName("解析不出条目 → 具体原因（0 条）")
    void reportsZeroItems() {
        BriefingFetchException error = assertThrows(BriefingFetchException.class,
                () -> fetcher(FakeTransport.body("<rss><channel></channel></rss>")).fetch(5));
        assertTrue(error.getMessage().contains("0 条"), error.getMessage());
    }

    @Test
    @DisplayName("传输层失败原样上抛（fake 会抛异常 → 说明测试不会真的发请求）")
    void propagatesTransportFailure() {
        BriefingFetchException error = assertThrows(BriefingFetchException.class,
                () -> fetcher(FakeTransport.failing("HTTP 403")).fetch(5));
        assertEquals("HTTP 403", error.getMessage());
    }
}

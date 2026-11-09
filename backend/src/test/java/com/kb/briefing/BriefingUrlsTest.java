package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** BRIEFING.md §3：URL 规范化（去 fragment / 去跟踪参数）。 */
class BriefingUrlsTest {

    @Test
    @DisplayName("去 fragment 与 utm_* / fbclid / ref 等跟踪参数")
    void stripsTracking() {
        assertEquals("https://example.com/a",
                BriefingUrls.normalize("https://example.com/a#section"));
        assertEquals("https://example.com/a?id=2",
                BriefingUrls.normalize("https://example.com/a?utm_source=x&id=2&fbclid=abc&ref=hn"));
        assertEquals("https://example.com/a",
                BriefingUrls.normalize("https://example.com/a?utm_medium=email"));
        assertEquals("https://example.com/a?id=2",
                BriefingUrls.normalize("https://example.com/a?id=2&spm=1&gclid=9"));
    }

    @Test
    @DisplayName("同一链接的不同形态归一化后相等（去重依据）")
    void normalizesToSameValue() {
        String a = BriefingUrls.normalize("https://Example.com/post?id=1&utm_source=rss#top");
        String b = BriefingUrls.normalize("https://Example.com/post?id=1");
        assertEquals(a, b);
    }

    @Test
    @DisplayName("SSRF：内网/回环/链路本地/单段主机名/非 http 一律拒绝，公网放行")
    void rejectsInternalAddresses() {
        assertEquals(false, BriefingUrls.isPublicHttpUrl("http://127.0.0.1:8080/api/health"));
        assertEquals(false, BriefingUrls.isPublicHttpUrl("http://localhost:8090/x"));
        assertEquals(false, BriefingUrls.isPublicHttpUrl("http://10.0.0.5/x"));
        assertEquals(false, BriefingUrls.isPublicHttpUrl("http://172.16.3.4/x"));
        assertEquals(false, BriefingUrls.isPublicHttpUrl("http://192.168.1.1/x"));
        assertEquals(false, BriefingUrls.isPublicHttpUrl("http://169.254.169.254/latest/meta-data"));
        assertEquals(false, BriefingUrls.isPublicHttpUrl("http://[::1]:8080/x"));
        assertEquals(false, BriefingUrls.isPublicHttpUrl("http://intranet/x"));
        assertEquals(false, BriefingUrls.isPublicHttpUrl("file:///etc/passwd"));
        assertEquals(false, BriefingUrls.isPublicHttpUrl("http://0.0.0.0:9000/x"));
        assertTrue(BriefingUrls.isPublicHttpUrl("https://www.anthropic.com/news/x"));
        assertTrue(BriefingUrls.isPublicHttpUrl("https://www-cdn.anthropic.com/abc.jpg"));
        assertTrue(BriefingUrls.isPublicHttpUrl("https://218.1.2.3/x"));
    }

    @Test
    @DisplayName("只认 http/https；畸形 URL 至少去掉 fragment")
    void handlesOddInput() {
        assertTrue(BriefingUrls.isHttpUrl("https://a.com/x"));
        assertFalse(BriefingUrls.isHttpUrl("ftp://a.com/x"));
        assertFalse(BriefingUrls.isHttpUrl(""));
        assertEquals("not a url", BriefingUrls.normalize("not a url#frag"));
    }
}

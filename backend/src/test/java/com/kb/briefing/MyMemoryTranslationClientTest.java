package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 翻译客户端：正常译文、配额告警识别、熔断（全程 fake 传输层，不联网）。 */
class MyMemoryTranslationClientTest {

    private static final String OK_BODY = "{\"responseData\":{\"translatedText\":\"你好世界\",\"match\":1},"
            + "\"quotaFinished\":false,\"responseStatus\":200}";
    private static final String QUOTA_BODY = "{\"responseData\":{\"translatedText\":\"MYMEMORY WARNING: YOU USED ALL "
            + "AVAILABLE FREE TRANSLATIONS FOR TODAY.\"},\"quotaFinished\":true,\"responseStatus\":429}";

    @Test
    @DisplayName("正常返回中文译文；请求里必须带 de=（私有配额）")
    void translates() {
        StringBuilder seenUrl = new StringBuilder();
        MyMemoryTranslationClient client = new MyMemoryTranslationClient(new HttpTransport() {

            @Override
            public String get(String url) {
                return get(url, "application/json");
            }

            @Override
            public String get(String url, String accept) {
                seenUrl.append(url);
                return OK_BODY;
            }
        });
        assertEquals("你好世界", client.translate("hello world"));
        assertTrue(seenUrl.toString().contains("de="), "必须带 de= 联系邮箱，否则会被匿名配额卡死");
        assertTrue(seenUrl.toString().contains("langpair=en%7Czh-CN"), seenUrl.toString());
    }

    @Test
    @DisplayName("配额告警绝不能被当成译文写进简报")
    void rejectsQuotaWarning() {
        assertTrue(MyMemoryTranslationClient.looksLikeQuotaWarning(
                "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY."));
        assertFalse(MyMemoryTranslationClient.looksLikeQuotaWarning("你好世界"));
        MyMemoryTranslationClient client = new MyMemoryTranslationClient(new HttpTransport() {

            @Override
            public String get(String url) {
                return QUOTA_BODY;
            }

            @Override
            public String get(String url, String accept) {
                return QUOTA_BODY;
            }
        });
        BriefingFetchException error = assertThrows(BriefingFetchException.class,
                () -> client.translate("hello world"));
        assertTrue(error.getMessage().contains("配额"), error.getMessage());
    }

    @Test
    @DisplayName("连续失败 3 次后熔断，不再发请求")
    void breaksCircuitAfterFailures() {
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        MyMemoryTranslationClient client = new MyMemoryTranslationClient(new HttpTransport() {

            @Override
            public String get(String url) {
                return get(url, "application/json");
            }

            @Override
            public String get(String url, String accept) {
                calls.incrementAndGet();
                throw new BriefingFetchException("HTTP 429");
            }
        });
        assertThrows(BriefingFetchException.class, () -> client.translate("one"));
        assertThrows(BriefingFetchException.class, () -> client.translate("two"));
        assertThrows(BriefingFetchException.class, () -> client.translate("three"));
        int before = calls.get();
        BriefingFetchException error = assertThrows(BriefingFetchException.class,
                () -> client.translate("four"));
        assertTrue(error.getMessage().contains("熔断"), error.getMessage());
        assertEquals(before, calls.get(), "熔断后不得再发请求");
    }
}

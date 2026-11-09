package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** provider 选择：auto / deepl / mymemory / none。 */
class BriefingTranslationConfigTest {

    private static final HttpTransport NOOP_TRANSPORT = new HttpTransport() {

        @Override
        public String get(String url) {
            throw new UnsupportedOperationException();
        }

        @Override
        public String get(String url, String accept) {
            throw new UnsupportedOperationException();
        }

        @Override
        public String post(String url, Map<String, String> headers, String body, Duration timeout) {
            throw new UnsupportedOperationException();
        }
    };

    private static String providerOf(String provider, String key, String endpoint) {
        BriefingProperties properties = new BriefingProperties();
        properties.setTranslateProvider(provider);
        properties.setDeeplKey(key);
        properties.setDeeplEndpoint(endpoint);
        return BriefingTranslationConfig.choose(properties, NOOP_TRANSPORT).providerName();
    }

    @Test
    @DisplayName("auto：有 key 用 DeepL（free/pro 按后缀），没 key 用 MyMemory")
    void autoPicksByKey() {
        assertEquals("deepl(free)", providerOf("auto", "abc:fx", null));
        assertEquals("deepl(pro)", providerOf("auto", "abc", null));
        assertEquals("mymemory", providerOf("auto", "", null));
        assertEquals("mymemory", providerOf("", "", null));
    }

    @Test
    @DisplayName("显式 deepl 但没 key → 回落 MyMemory（不让简报因此失败）")
    void deeplWithoutKeyFallsBack() {
        assertEquals("mymemory", providerOf("deepl", "", null));
        assertEquals("deepl(free)", providerOf("deepl", "k:fx", null));
    }

    @Test
    @DisplayName("none → 不翻译；mymemory → 强制 MyMemory")
    void explicitProviders() {
        assertEquals("none", providerOf("none", "abc:fx", null));
        assertEquals("mymemory", providerOf("mymemory", "abc:fx", null));
    }

    @Test
    @DisplayName("none 时 translateAll 全部返回 null（保留原文）")
    void noopReturnsNulls() {
        List<String> result = new NoopTranslationClient().translateAll(List.of("a", "b"));
        assertEquals(2, result.size());
        assertEquals(null, result.get(0));
        assertEquals(null, result.get(1));
    }
}

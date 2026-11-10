package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 主翻译挂掉时改用备用：DeepL key 失效不能把简报整篇留在英文。 */
class FallbackTranslationClientTest {

    private static TranslationClient fixed(String name, List<String> values, AtomicInteger calls) {
        return new TranslationClient() {
            @Override
            public String translate(String text) {
                calls.incrementAndGet();
                return values.isEmpty() ? null : values.get(0);
            }

            @Override
            public List<String> translateAll(List<String> texts) {
                calls.incrementAndGet();
                return values;
            }

            @Override
            public String providerName() {
                return name;
            }
        };
    }

    private static TranslationClient failing(String name, AtomicInteger calls) {
        return new TranslationClient() {
            @Override
            public String translate(String text) {
                calls.incrementAndGet();
                throw new BriefingFetchException("HTTP 403（鉴权失败）");
            }

            @Override
            public List<String> translateAll(List<String> texts) {
                calls.incrementAndGet();
                throw new BriefingFetchException("HTTP 403（鉴权失败）");
            }

            @Override
            public String providerName() {
                return name;
            }
        };
    }

    @Test
    @DisplayName("主翻译整体失败 → 用备用，且后续不再重复调用主翻译")
    void fallsBackAfterPrimaryFailure() {
        AtomicInteger primaryCalls = new AtomicInteger();
        AtomicInteger backupCalls = new AtomicInteger();
        FallbackTranslationClient client = new FallbackTranslationClient(
                failing("deepl(free)", primaryCalls), fixed("mymemory", List.of("你好", "世界"), backupCalls));

        assertEquals(List.of("你好", "世界"), client.translateAll(List.of("hello", "world")));
        assertEquals(List.of("你好", "世界"), client.translateAll(List.of("hello", "world")));
        assertEquals(1, primaryCalls.get());
        assertEquals(2, backupCalls.get());
        assertEquals("deepl(free)→mymemory", client.providerName());
    }

    @Test
    @DisplayName("主翻译只失败一部分 → 只把失败的那几条交给备用补齐")
    void fillsOnlyMissingItems() {
        AtomicInteger backupCalls = new AtomicInteger();
        List<String> partial = new ArrayList<>();
        partial.add("标题");
        partial.add(null);
        FallbackTranslationClient client = new FallbackTranslationClient(
                fixed("deepl(free)", partial, new AtomicInteger()),
                fixed("mymemory", List.of("摘要"), backupCalls));

        assertEquals(List.of("标题", "摘要"), client.translateAll(List.of("title", "summary")));
        assertEquals(1, backupCalls.get());
    }

    @Test
    @DisplayName("两家都挂 → 返回 null 保留原文，不把异常抛给调用方")
    void bothFailKeepsOriginal() {
        FallbackTranslationClient client = new FallbackTranslationClient(
                failing("deepl(free)", new AtomicInteger()), failing("mymemory", new AtomicInteger()));

        List<String> result = client.translateAll(List.of("hello", "world"));
        assertEquals(2, result.size());
        assertNull(result.get(0));
        assertNull(result.get(1));
    }

    @Test
    @DisplayName("空白输入不算失败，不会送去备用翻译")
    void skipsBlankInput() {
        AtomicInteger backupCalls = new AtomicInteger();
        FallbackTranslationClient client = new FallbackTranslationClient(
                fixed("deepl(free)", Arrays.asList("标题", null), new AtomicInteger()),
                fixed("mymemory", List.of("x"), backupCalls));

        List<String> result = client.translateAll(List.of("title", "  "));
        assertEquals(Arrays.asList("标题", null), result);
        assertEquals(0, backupCalls.get());
    }
}

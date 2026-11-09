package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** DeepL provider：端点选择、鉴权头、批量分片、错误分类（全程 fake 传输层）。 */
class DeepLTranslationClientTest {

    /** 记录请求的 fake：按顺序返回预置响应。 */
    private static class RecordingTransport implements HttpTransport {

        final List<String> urls = new ArrayList<>();
        final List<String> headers = new ArrayList<>();
        final List<String> bodies = new ArrayList<>();
        RuntimeException failure;
        String response = "{\"translations\":[{\"detected_source_language\":\"EN\",\"text\":\"你好\"}]}";

        @Override
        public String get(String url) {
            throw new UnsupportedOperationException();
        }

        @Override
        public String get(String url, String accept) {
            throw new UnsupportedOperationException();
        }

        @Override
        public String post(String url, Map<String, String> requestHeaders, String body, Duration timeout) {
            urls.add(url);
            headers.add(String.valueOf(requestHeaders.get("Authorization")));
            bodies.add(body);
            if (failure != null) {
                throw failure;
            }
            int count = body.split("&text=", -1).length - 1 + 1;   // 首个 text 没有前缀
            StringBuilder json = new StringBuilder("{\"translations\":[");
            for (int index = 0; index < count; index++) {
                if (index > 0) {
                    json.append(',');
                }
                json.append("{\"text\":\"译文").append(index + 1).append("\"}");
            }
            return json.append("]}").toString();
        }
    }

    @Test
    @DisplayName(":fx 结尾的 key → api-free；否则 → api；显式端点可覆盖")
    void picksEndpointByKey() {
        assertEquals("https://api-free.deepl.com/v2/translate", DeepLTranslationClient.defaultEndpoint("abc:fx"));
        assertEquals("https://api.deepl.com/v2/translate", DeepLTranslationClient.defaultEndpoint("abc"));
        assertTrue(DeepLTranslationClient.isFreeKey("ABC:FX"));
        assertFalse(DeepLTranslationClient.isFreeKey("abc"));

        RecordingTransport transport = new RecordingTransport();
        new DeepLTranslationClient(transport, "k:fx", null).translate("hello");
        assertEquals("https://api-free.deepl.com/v2/translate", transport.urls.get(0));

        transport = new RecordingTransport();
        new DeepLTranslationClient(transport, "k", null).translate("hello");
        assertEquals("https://api.deepl.com/v2/translate", transport.urls.get(0));

        transport = new RecordingTransport();
        new DeepLTranslationClient(transport, "k:fx", "https://proxy.local/v2/translate").translate("hello");
        assertEquals("https://proxy.local/v2/translate", transport.urls.get(0));
    }

    @Test
    @DisplayName("鉴权头 + target_lang=ZH，返回顺序与请求一致")
    void sendsAuthHeaderAndParsesOrder() {
        RecordingTransport transport = new RecordingTransport();
        DeepLTranslationClient client = new DeepLTranslationClient(transport, "secret-key:fx", null);
        List<String> result = client.translateAll(List.of("first", "second"));
        assertEquals(List.of("译文1", "译文2"), result);
        assertTrue(transport.headers.get(0).startsWith("DeepL-Auth-Key secret-key"),
                "必须用 Authorization: DeepL-Auth-Key 头");
        assertTrue(transport.bodies.get(0).endsWith("target_lang=ZH"), transport.bodies.get(0));
        assertTrue(transport.bodies.get(0).contains("text=first&text=second"), transport.bodies.get(0));
    }

    @Test
    @DisplayName("批量分片：60 条拆成 50 + 10 两次请求")
    void splitsIntoChunksOf50() {
        RecordingTransport transport = new RecordingTransport();
        DeepLTranslationClient client = new DeepLTranslationClient(transport, "k:fx", null);
        List<String> texts = new ArrayList<>();
        for (int index = 0; index < 60; index++) {
            texts.add("text-" + index);
        }
        List<String> result = client.translateAll(texts);
        assertEquals(60, result.size());
        assertEquals(2, transport.urls.size(), "60 条应拆成 2 次请求");
        String firstBody = transport.bodies.get(0);
        assertEquals(50, firstBody.split("&text=", -1).length, "第一片应为 50 条: " + firstBody.split("&text=", -1).length);
        String secondBody = transport.bodies.get(1);
        assertEquals(10, secondBody.split("&text=", -1).length, "第二片应为 10 条");
    }

    @Test
    @DisplayName("403/456/429 分别识别为 key 无效 / 额度用尽 / 限流，且不当成功")
    void classifiesHttpErrors() {
        assertTrue(DeepLTranslationClient.describeHttpError("HTTP 403（响应开头：x）").contains("鉴权失败"));
        assertTrue(DeepLTranslationClient.describeHttpError("HTTP 456").contains("额度"));
        assertTrue(DeepLTranslationClient.describeHttpError("HTTP 429").contains("限流"));

        RecordingTransport transport = new RecordingTransport();
        transport.failure = new BriefingFetchException("HTTP 403（响应开头：forbidden）");
        DeepLTranslationClient client = new DeepLTranslationClient(transport, "bad-key:fx", null);
        BriefingFetchException error = assertThrows(BriefingFetchException.class,
                () -> client.translateAll(List.of("a", "b")));
        assertTrue(error.getMessage().contains("鉴权失败"), error.getMessage());
    }

    @Test
    @DisplayName("没配 key 时直接失败（不发出请求）")
    void refusesWithoutKey() {
        RecordingTransport transport = new RecordingTransport();
        DeepLTranslationClient client = new DeepLTranslationClient(transport, "", null);
        assertThrows(BriefingFetchException.class, () -> client.translateAll(List.of("a")));
        assertTrue(transport.urls.isEmpty());
    }

    @Test
    @DisplayName("返回条数与请求不一致 → 失败（不把错位译文写进简报）")
    void rejectsMismatchedCount() {
        // 请求 2 条但只回 1 条 → 必须报错，不能把错位译文写进简报
        RecordingTransport mismatched = new RecordingTransport() {
            @Override
            public String post(String url, Map<String, String> requestHeaders, String body, Duration timeout) {
                return "{\"translations\":[{\"text\":\"只有一条\"}]}";
            }
        };
        DeepLTranslationClient broken = new DeepLTranslationClient(mismatched, "k:fx", null);
        BriefingFetchException error = assertThrows(BriefingFetchException.class,
                () -> broken.translateAll(List.of("a", "b")));
        assertTrue(error.getMessage().contains("条数"), error.getMessage());
    }

    @Test
    @DisplayName("连续失败 3 次后熔断，不再打 DeepL")
    void breaksCircuit() {
        RecordingTransport transport = new RecordingTransport();
        transport.failure = new BriefingFetchException("HTTP 456");
        DeepLTranslationClient client = new DeepLTranslationClient(transport, "k:fx", null);
        assertThrows(BriefingFetchException.class, () -> client.translateAll(List.of("a")));
        assertThrows(BriefingFetchException.class, () -> client.translateAll(List.of("b")));
        assertThrows(BriefingFetchException.class, () -> client.translateAll(List.of("c")));
        int callsBefore = transport.urls.size();
        BriefingFetchException error = assertThrows(BriefingFetchException.class,
                () -> client.translateAll(List.of("d")));
        assertTrue(error.getMessage().contains("熔断"), error.getMessage());
        assertEquals(callsBefore, transport.urls.size(), "熔断后不得再请求 DeepL");
    }

    @Test
    @DisplayName("providerName 说明 free/pro，且不含 key")
    void providerNameHasNoKey() {
        assertTrue(new DeepLTranslationClient(new RecordingTransport(), "secret:fx", null)
                .providerName().equals("deepl(free)"));
        assertTrue(new DeepLTranslationClient(new RecordingTransport(), "secret", null)
                .providerName().equals("deepl(pro)"));
    }

    @Test
    @DisplayName("单条翻译走 translate→translateAll，空响应文本视为失败")
    void singleTranslateRejectsEmpty() {
        RecordingTransport transport = new RecordingTransport() {
            @Override
            public String post(String url, Map<String, String> requestHeaders, String body, Duration timeout) {
                return "{\"translations\":[{\"text\":\"\"}]}";
            }
        };
        assertNull(new DeepLTranslationClient(transport, "k:fx", null)
                .translateAll(List.of("a")).get(0));
    }
}

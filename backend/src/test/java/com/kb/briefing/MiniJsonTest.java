package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 极简 JSON 读写（HN 响应 + sourceReport 落库）。 */
class MiniJsonTest {

    @Test
    @DisplayName("解析对象/数组/转义，并能原样写回")
    void parsesAndWrites() {
        Object parsed = MiniJson.parse("{\"hits\":[{\"title\":\"A \\\"b\\\" c\",\"points\":128,"
                + "\"url\":null}],\"ok\":true}");
        Map<String, Object> root = MiniJson.asObject(parsed);
        assertEquals(Boolean.TRUE, root.get("ok"));
        List<Object> hits = MiniJson.asArray(root.get("hits"));
        assertEquals(1, hits.size());
        Map<String, Object> hit = MiniJson.asObject(hits.get(0));
        assertEquals("A \"b\" c", MiniJson.string(hit.get("title")));
        assertEquals(128, MiniJson.integer(hit.get("points")));
        assertEquals(null, hit.get("url"));

        String written = MiniJson.write(Map.of("a", List.of("x", 1, true)));
        assertTrue(written.startsWith("{\"a\":[\"x\",1,true]}"), written);
    }

    @Test
    @DisplayName("转义字符往返：换行、反斜杠、引号")
    void escapesRoundTrip() {
        String text = "line1\nline2\\tail \"quoted\"";
        String json = MiniJson.write(Map.of("v", text));
        assertEquals(text, MiniJson.string(MiniJson.asObject(MiniJson.parse(json)).get("v")));
    }

    @Test
    @DisplayName("非法 JSON 抛 IllegalArgumentException")
    void rejectsInvalid() {
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> MiniJson.parse("{\"a\":}"));
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> MiniJson.parse("{\"a\":1} extra"));
    }
}

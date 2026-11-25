package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** P2 安全加固：JSON 深度/代理对、SSRF 字面量、simhash 近重复。 */
class SecurityHardeningTest {

    @Test
    @DisplayName("MiniJson 正确合并 UTF-16 代理对")
    void surrogatePairs() {
        Object parsed = MiniJson.parse("{\"text\":\"\\ud83d\\ude00\"}");
        assertEquals("😀", MiniJson.string(MiniJson.asObject(parsed).get("text")));
    }

    @Test
    @DisplayName("MiniJson 解析深度超过 64 时抛异常，不再栈溢出")
    void depthLimit() {
        StringBuilder json = new StringBuilder();
        for (int i = 0; i < 80; i++) json.append('[');
        for (int i = 0; i < 80; i++) json.append(']');
        assertThrows(IllegalArgumentException.class, () -> MiniJson.parse(json.toString()));
    }

    @Test
    @DisplayName("SSRF：回环 / 非常规 IP 写法 / 单段主机名都被拒绝")
    void ssrfRejectsLoopbackVariants() {
        assertFalse(BriefingUrls.isPublicHttpUrl("http://127.0.0.1"));
        assertFalse(BriefingUrls.isPublicHttpUrl("http://0177.0.0.1"));
        assertFalse(BriefingUrls.isPublicHttpUrl("http://0x7f000001"));
        assertFalse(BriefingUrls.isPublicHttpUrl("http://[::1]/"));
        assertFalse(BriefingUrls.isPublicHttpUrl("http://localhost:8080"));
        assertFalse(BriefingUrls.isPublicHttpUrl("http://intranet"));
    }

    @Test
    @DisplayName("simhash：同一件事的改写被判近重复，不同事不误判")
    void semanticDedupe() {
        SemanticDeduper deduper = new SemanticDeduper();
        var a = deduper.fingerprint("OpenAI 发布新模型，编码能力大幅提升");
        var b = deduper.fingerprint("OpenAI 发布新模型，编码能力大幅提升。");
        var c = deduper.fingerprint("量子位报道国内大模型价格战");
        assertTrue(deduper.isNearDuplicate(b, List.of(a)));
        assertFalse(deduper.isNearDuplicate(c, List.of(a, b)));
    }
}

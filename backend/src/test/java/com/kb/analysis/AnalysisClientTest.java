package com.kb.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** AI 分析契约与严格解析：坏响应一律降级为空，绝不影响生成流程。 */
class AnalysisClientTest {

    @Test
    @DisplayName("默认 Noop 客户端不返回任何结果，也不伪装成可用 provider")
    void noopClientDoesNothing() {
        AnalysisClient client = new NoopAnalysisClient();
        Optional<AnalysisResult> result = client.analyze(new AnalysisRequest("标题", "摘要", "openai"));
        assertTrue(result.isEmpty());
        assertEquals("none", client.providerName());
    }

    @Test
    @DisplayName("合法 JSON 被解析为结构化结果")
    void parsesValidJson() {
        String json = """
                {"oneLiner":"一句话摘要","keyPoints":["点一","点二","点三"],
                 "whyItMatters":"因为与你相关","audience":"后端开发者",
                 "risks":["尚未实测"],"confidence":0.82,"tags":["AI","工具"]}
                """;
        AnalysisResult result = AnalysisResult.parse(json).orElseThrow();
        assertEquals("一句话摘要", result.oneLiner());
        assertEquals(3, result.keyPoints().size());
        assertEquals(0.82, result.confidence());
        assertEquals(2, result.tags().size());
    }

    @Test
    @DisplayName("非法 JSON / 缺字段 / 超范围一律返回 empty")
    void rejectsInvalidResponses() {
        assertTrue(AnalysisResult.parse("not json").isEmpty());
        assertTrue(AnalysisResult.parse("{}").isEmpty());
        assertTrue(AnalysisResult.parse("{\"oneLiner\":\"   \"}").isEmpty());
        assertTrue(AnalysisResult.parse("{\"oneLiner\":\"x\",\"keyPoints\":[]}").isEmpty());
        assertTrue(AnalysisResult.parse("{\"oneLiner\":\"x\",\"keyPoints\":[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\"]}").isEmpty());
        assertTrue(AnalysisResult.parse("{\"oneLiner\":\"x\",\"keyPoints\":[\"a\"],\"confidence\":5}").isEmpty());
        assertTrue(AnalysisResult.parse("{\"oneLiner\":\"" + "长".repeat(400) + "\",\"keyPoints\":[\"a\"]}").isEmpty());
    }

    @Test
    @DisplayName("缺省可选字段用安全默认值，不抛异常")
    void fillsOptionalDefaults() {
        AnalysisResult result = AnalysisResult.parse("{\"oneLiner\":\"x\",\"keyPoints\":[\"a\"]}").orElseThrow();
        assertTrue(result.whyItMatters() == null || result.whyItMatters().isBlank());
        assertTrue(result.risks().isEmpty());
        assertTrue(result.tags().isEmpty());
        assertEquals(0.5, result.confidence());
    }

    @Test
    @DisplayName("默认配置：provider=none、上限 20、地址/模型留空")
    void defaultPropertiesAreSafe() {
        AnalysisProperties properties = new AnalysisProperties();
        assertEquals("none", properties.getProvider());
        assertFalse(properties.isEnabled());
        assertEquals(20, properties.getMaxItemsPerRun());
        assertTrue(properties.getBaseUrl() == null || properties.getBaseUrl().isBlank());
        assertTrue(properties.getModel() == null || properties.getModel().isBlank());
    }
}

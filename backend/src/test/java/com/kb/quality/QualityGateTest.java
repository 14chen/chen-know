package com.kb.quality;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 评分编排：多规则叠加、分数下限、阈值 70、可配置模板句。 */
class QualityGateTest {

    private static QualityGate gate() {
        return new QualityGate(new QualityProperties());
    }

    @Test
    @DisplayName("干净条目得 100 分且进入必读候选")
    void cleanItemIsAccepted() {
        QualityResult result = gate().evaluate(new QualityInput("标题", "一段完整、有信息量的中文摘要。", List.of()));
        assertEquals(100, result.score());
        assertTrue(result.accepted());
        assertTrue(result.reasons().isEmpty());
    }

    @Test
    @DisplayName("硬拒绝规则把分数压到 0，且不进入必读候选")
    void fatalRuleZeroesScore() {
        QualityResult result = gate().evaluate(new QualityInput(null, "摘要", List.of()));
        assertEquals(0, result.score());
        assertFalse(result.accepted());
        assertTrue(result.reasons().stream().anyMatch(r -> r.contains("missing_text")));
    }

    @Test
    @DisplayName("近似重复只扣 60 → 40 分，降级保留但不归零")
    void duplicateIsDowngraded() {
        String text = "自主人工智能正在电力电子领域崭露头角，驱动着工程师完成过去靠手工完成的模拟循环。";
        QualityResult result = gate().evaluate(new QualityInput("有标题的条目", text, List.of(text)));
        assertEquals(40, result.score());
        assertFalse(result.accepted());
        assertTrue(result.reasons().stream().anyMatch(r -> r.contains("near_duplicate")));
    }

    @Test
    @DisplayName("阈值可配：把阈值调低后同一条低分内容进入候选")
    void thresholdIsConfigurable() {
        QualityProperties properties = new QualityProperties();
        properties.setThreshold(40);
        String text = "自主人工智能正在电力电子领域崭露头角，驱动着工程师完成过去靠手工完成的模拟循环。";
        QualityResult result = new QualityGate(properties).evaluate(new QualityInput("有标题的条目", text, List.of(text)));
        assertTrue(result.accepted());
    }

    @Test
    @DisplayName("默认模板清单与用户追加的模板都生效")
    void templatePatternsAreConfigurable() {
        QualityProperties properties = new QualityProperties();
        properties.setTemplatePatterns(List.of("本源暂无摘要"));
        QualityGate configured = new QualityGate(properties);
        assertTrue(configured.evaluate(new QualityInput("", "本源暂无摘要", List.of())).score() == 0);
        assertTrue(configured.evaluate(new QualityInput("", "RadixArk 在 Hugging Face 上发布的博客文章", List.of()))
                .score() == 0, "默认清单仍需生效");
    }

    @Test
    @DisplayName("阈值被夹紧到 0–100，非法配置不会让所有条目都通过或都拒绝")
    void thresholdIsClamped() {
        QualityProperties properties = new QualityProperties();
        properties.setThreshold(500);
        assertEquals(100, properties.getThreshold());
        properties.setThreshold(-10);
        assertEquals(0, properties.getThreshold());
    }
}

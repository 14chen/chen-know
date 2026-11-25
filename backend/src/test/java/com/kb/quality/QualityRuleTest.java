package com.kb.quality;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 质量规则单测：全部是纯函数，不发网络、不读数据库。 */
class QualityRuleTest {

    private static QualityInput input(String title, String summary) {
        return new QualityInput(title, summary, List.of());
    }

    @Test
    @DisplayName("标题或摘要为 null/空白 → NullRule 命中")
    void nullTextIsRejected() {
        assertTrue(new NullRule().penalty(input(null, "正常摘要")) > 0);
        assertTrue(new NullRule().penalty(input("标题", "   ")) > 0);
        assertEquals(0, new NullRule().penalty(input("标题", "正常摘要")));
    }

    @Test
    @DisplayName("实测模板套话 → BoilerplateRule 命中；正常摘要不命中")
    void boilerplateIsRejected() {
        BoilerplateRule rule = new BoilerplateRule(List.of("在 Hugging Face 上发布的博客文章"));
        assertTrue(rule.penalty(input("", "RadixArk 在 Hugging Face 上发布的博客文章")) > 0);
        assertEquals(0, rule.penalty(input("", "OpenAI 发布了新的编码代理评测基准。")));
    }

    @Test
    @DisplayName("以省略号结尾且过短 → TruncationRule 命中；长摘要不命中")
    void shortTruncationIsRejected() {
        TruncationRule rule = new TruncationRule();
        assertTrue(rule.penalty(input("", "我们正在研究……")) > 0);
        assertEquals(0, rule.penalty(input("", "这是一段足够长的摘要，".repeat(8) + "……")));
        assertEquals(0, rule.penalty(input("", "简短但完整的摘要。")));
    }

    @Test
    @DisplayName("未清理的 LaTeX 残留 → LatexRule 命中")
    void latexResidueIsRejected() {
        LatexRule rule = new LatexRule();
        assertTrue(rule.penalty(input("", "我们隆重推出 \\textbf{ARCHER} 框架")) > 0);
        assertTrue(rule.penalty(input("", "损失由 \\frac{a}{b} 计算")) > 0);
        assertEquals(0, rule.penalty(input("", "普通的中文摘要。")));
    }

    @Test
    @DisplayName("与前序条目 5-gram 高度重合 → DuplicateRule 降级而非拒绝")
    void nearDuplicateIsDowngradedNotRejected() {
        String text = "自主人工智能正在电力电子领域崭露头角，驱动着工程师完成过去靠手工完成的模拟循环。";
        DuplicateRule rule = new DuplicateRule();
        int penalty = rule.penalty(new QualityInput("", text, List.of(text)));
        assertTrue(penalty > 0 && penalty < 100, "重复应扣分但保留内容: " + penalty);
        assertEquals(0, rule.penalty(new QualityInput("", text, List.of("完全不同的另一条内容。"))));
    }

    @Test
    @DisplayName("干净条目不触发任何规则")
    void cleanItemPassesAll() {
        QualityInput clean = input("DaisyRose-27B：突破训练后效率的极限",
                "RadixArk 发布了 27B 参数模型，重点改进训练后阶段的吞吐与显存占用。");
        assertEquals(0, new NullRule().penalty(clean));
        assertEquals(0, new TruncationRule().penalty(clean));
        assertEquals(0, new LatexRule().penalty(clean));
        assertEquals(0, new DuplicateRule().penalty(clean));
        assertEquals(0, new BoilerplateRule(List.of("在 Hugging Face 上发布的博客文章")).penalty(clean));
    }
}

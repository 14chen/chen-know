package com.kb.quality;

import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * 质量闸门：把所有规则串起来，输出可解释的分数与理由。
 *
 * <p>低分条目不会被丢弃 —— 只在「今日必读」候选中排除，正文仍保留（P1 明确边界）。
 */
@Component
public class QualityGate {

    private final QualityProperties properties;
    private final List<QualityRule> rules;

    public QualityGate(QualityProperties properties) {
        this.properties = properties;
        this.rules = List.of(
                new NullRule(),
                new BoilerplateRule(properties.getTemplatePatterns()),
                new TruncationRule(),
                new LatexRule(),
                new DuplicateRule());
    }

    public QualityResult evaluate(QualityInput input) {
        int penalty = 0;
        List<String> reasons = new ArrayList<>();
        for (QualityRule rule : rules) {
            int current = rule.penalty(input);
            if (current > 0) {
                penalty += current;
                reasons.add(rule.id() + ": " + rule.reason());
            }
        }
        int score = Math.max(0, 100 - penalty);
        return new QualityResult(score, score >= properties.getThreshold(), List.copyOf(reasons),
                input.normalized());
    }
}

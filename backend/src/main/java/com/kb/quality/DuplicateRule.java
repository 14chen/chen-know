package com.kb.quality;

import java.util.HashSet;
import java.util.Set;

/**
 * 同一批次里跨源的近似重复：5-gram Jaccard > 0.8 判重复。
 * 只扣 60 分（降级保留），不直接丢弃 —— 不丢信息是 P1 的明确边界。
 */
public class DuplicateRule implements QualityRule {

    private static final int GRAM = 5;
    private static final double THRESHOLD = 0.8;
    private static final int PENALTY = 60;

    @Override
    public String id() {
        return "near_duplicate";
    }

    @Override
    public int penalty(QualityInput input) {
        Set<String> current = shingles(input.summary());
        if (current.isEmpty()) return 0;   // 空摘要交给 NullRule
        for (String prior : input.priorTexts()) {
            Set<String> other = shingles(prior);
            if (other.isEmpty()) continue;
            if (jaccard(current, other) > THRESHOLD) return PENALTY;
        }
        return 0;
    }

    private static Set<String> shingles(String text) {
        Set<String> result = new HashSet<>();
        if (text == null) return result;
        String normalized = text.replaceAll("\\s+", " ").trim();
        for (int i = 0; i + GRAM <= normalized.length(); i++) {
            result.add(normalized.substring(i, i + GRAM));
        }
        return result;
    }

    private static double jaccard(Set<String> a, Set<String> b) {
        Set<String> union = new HashSet<>(a);
        union.addAll(b);
        if (union.isEmpty()) return 0;
        Set<String> intersection = new HashSet<>(a);
        intersection.retainAll(b);
        return (double) intersection.size() / union.size();
    }

    @Override
    public String reason() {
        return "与前序条目高度相似（跨源重复）";
    }
}

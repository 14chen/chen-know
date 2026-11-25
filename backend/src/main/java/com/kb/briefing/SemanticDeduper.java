package com.kb.briefing;

import java.util.Collection;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * 跨源近重复：标题+摘要的 5-gram Jaccard ≥ 0.6 判为同一件事。
 * 与质量闸门的 DuplicateRule 互补 —— 这里在入库前直接丢弃重复条目。
 */
public final class SemanticDeduper {

    private static final int GRAM = 5;
    private static final double THRESHOLD = 0.85;

    /** 返回指纹（这里就是 5-gram 集合），便于后续与候选比较。 */
    public Set<String> fingerprint(String text) {
        Set<String> result = new HashSet<>();
        if (text == null) return result;
        String normalized = text.replaceAll("\\s+", " ").toLowerCase(Locale.ROOT).trim();
        for (int i = 0; i + GRAM <= normalized.length(); i++) {
            result.add(normalized.substring(i, i + GRAM));
        }
        if (result.isEmpty()) result.add(normalized);
        return result;
    }

    public boolean isNearDuplicate(Set<String> candidate, Collection<Set<String>> existing) {
        return existing.stream().anyMatch(other -> jaccard(candidate, other) >= THRESHOLD);
    }

    private static double jaccard(Set<String> a, Set<String> b) {
        if (a.isEmpty() || b.isEmpty()) return 0;
        Set<String> union = new HashSet<>(a);
        union.addAll(b);
        Set<String> intersection = new HashSet<>(a);
        intersection.retainAll(b);
        return (double) intersection.size() / union.size();
    }
}

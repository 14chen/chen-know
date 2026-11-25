package com.kb.analysis;

import com.kb.briefing.MiniJson;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * AI 分析结果。解析刻意严格：任何字段缺失/超长/类型错误都返回 empty，
 * 宁可没有分析，也不把幻觉或畸形内容带进知识库。
 */
public record AnalysisResult(String oneLiner, List<String> keyPoints, String whyItMatters, String audience,
        List<String> risks, double confidence, List<String> tags) {

    private static final int MAX_ONELINER = 300;
    private static final int MAX_POINT = 200;
    private static final int MAX_WHY = 500;
    private static final int MAX_AUDIENCE = 200;
    private static final int MAX_RISK = 200;
    private static final int MAX_TAG = 40;

    public static Optional<AnalysisResult> parse(String json) {
        try {
            Map<String, Object> object = MiniJson.asObject(MiniJson.parse(json));
            if (object.isEmpty()) return Optional.empty();
            String oneLiner = text(object.get("oneLiner"));
            if (oneLiner == null || oneLiner.length() > MAX_ONELINER) return Optional.empty();

            List<Object> rawPoints = MiniJson.asArray(object.get("keyPoints"));
            if (rawPoints.isEmpty() || rawPoints.size() > 5) return Optional.empty();
            List<String> points = strings(rawPoints, MAX_POINT);
            if (points == null) return Optional.empty();

            List<String> risks = strings(MiniJson.asArray(object.get("risks")), MAX_RISK);
            List<String> tags = strings(MiniJson.asArray(object.get("tags")), MAX_TAG);
            if (risks == null || risks.size() > 3 || tags == null || tags.size() > 5) return Optional.empty();

            Object rawConfidence = object.get("confidence");
            double confidence = rawConfidence instanceof Number number ? number.doubleValue() : 0.5;
            if (confidence < 0 || confidence > 1) return Optional.empty();

            String why = text(object.get("whyItMatters"));
            if (why != null && why.length() > MAX_WHY) return Optional.empty();
            String audience = text(object.get("audience"));
            if (audience != null && audience.length() > MAX_AUDIENCE) return Optional.empty();

            return Optional.of(new AnalysisResult(oneLiner, points, why, audience, risks, confidence, tags));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    /** 序列化到 ai_analysis.payload_json，字段与 parse 严格对应。 */
    public String toJson() {
        return MiniJson.write(java.util.Map.of(
                "oneLiner", oneLiner,
                "keyPoints", keyPoints,
                "whyItMatters", whyItMatters == null ? "" : whyItMatters,
                "audience", audience == null ? "" : audience,
                "risks", risks,
                "confidence", confidence,
                "tags", tags));
    }

    private static String text(Object value) {
        if (value == null) return null;
        String result = String.valueOf(value);
        return result.isBlank() ? null : result;
    }

    /** @return null 表示列表里有非法元素；调用方据此整体拒绝这次分析。 */
    private static List<String> strings(List<Object> raw, int maxLength) {
        List<String> result = new ArrayList<>();
        for (Object item : raw) {
            if (!(item instanceof String text) || text.isBlank() || text.length() > maxLength) return null;
            result.add(text);
        }
        return result;
    }
}

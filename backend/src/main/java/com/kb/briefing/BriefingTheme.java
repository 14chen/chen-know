package com.kb.briefing;

import java.util.List;
import java.util.Locale;

/** 主题聚类：AI tags 优先；无 AI 时用关键词兜底，固定 5 类。 */
public final class BriefingTheme {

    public static final String MODEL = "模型";
    public static final String PRODUCT = "产品";
    public static final String RESEARCH = "研究";
    public static final String POLICY = "政策";
    public static final String TOOL = "工具";
    public static final List<String> ALL = List.of(MODEL, PRODUCT, RESEARCH, POLICY, TOOL);

    private BriefingTheme() {
    }

    public static String classify(List<String> aiTags, String title, String summary) {
        if (aiTags != null) {
            for (String tag : aiTags) {
                if (tag == null) continue;
                String value = tag.toLowerCase(Locale.ROOT);
                if (value.contains("model") || value.contains("模型")) return MODEL;
                if (value.contains("product") || value.contains("产品")) return PRODUCT;
                if (value.contains("research") || value.contains("研究") || value.contains("paper")) return RESEARCH;
                if (value.contains("policy") || value.contains("政策") || value.contains("regulation")) return POLICY;
                if (value.contains("tool") || value.contains("工具") || value.contains("开源")) return TOOL;
            }
        }
        String text = ((title == null ? "" : title) + " " + (summary == null ? "" : summary))
                .toLowerCase(Locale.ROOT);
        if (matches(text, "模型", "model", "gpt", "llm", "参数", "训练")) return MODEL;
        if (matches(text, "发布", "推出", "上线", "product", "launch", "收购", "合作")) return PRODUCT;
        if (matches(text, "研究", "论文", "arxiv", "paper", "benchmark", "评测")) return RESEARCH;
        if (matches(text, "政策", "监管", "法规", "policy", "regulation", "合规")) return POLICY;
        return TOOL;
    }

    private static boolean matches(String text, String... keywords) {
        for (String keyword : keywords) {
            if (text.contains(keyword)) return true;
        }
        return false;
    }
}

package com.kb.quality;

/** 「……」结尾且内容过短：这是直接截断 RSS 摘要产生的，不是摘要。 */
public class TruncationRule implements QualityRule {

    static final int MIN_MEANINGFUL_LENGTH = 40;

    @Override
    public String id() {
        return "truncated";
    }

    @Override
    public int penalty(QualityInput input) {
        String summary = input.summary() == null ? "" : input.summary().trim();
        boolean truncated = summary.endsWith("……") || summary.endsWith("...");
        return truncated && summary.length() < MIN_MEANINGFUL_LENGTH ? 100 : 0;
    }

    @Override
    public String reason() {
        return "摘要被截断且过短";
    }
}

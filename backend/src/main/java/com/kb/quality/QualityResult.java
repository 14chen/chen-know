package com.kb.quality;

import java.util.List;

/** @param accepted true 表示可进入「今日必读」候选；false 只是降级，内容仍保留在正文。 */
public record QualityResult(int score, boolean accepted, List<String> reasons, String normalizedText) {

    /** 未评分时的安全默认：0 分、不进候选、无理由。 */
    public static final QualityResult EMPTY = new QualityResult(0, false, List.of(), "");
}

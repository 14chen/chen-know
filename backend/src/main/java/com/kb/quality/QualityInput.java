package com.kb.quality;

import java.util.List;
import java.util.Locale;

/** 一条待评分的内容。priorTexts 是同一批次里前序条目的文本，用于近似重复检测。 */
public record QualityInput(String title, String summary, List<String> priorTexts) {

    public QualityInput {
        priorTexts = priorTexts == null ? List.of() : List.copyOf(priorTexts);
    }

    public String combined() {
        return ((title == null ? "" : title) + " " + (summary == null ? "" : summary)).trim();
    }

    /** 归一化：合并空白 + 小写，供模板匹配与 5-gram 比较使用。 */
    public String normalized() {
        return combined().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT).trim();
    }
}

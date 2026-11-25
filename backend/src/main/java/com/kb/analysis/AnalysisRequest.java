package com.kb.analysis;

/** 一次分析的输入。标题与摘要来自外部源，始终视为不可信数据。 */
public record AnalysisRequest(String title, String summary, String sourceId) {
}

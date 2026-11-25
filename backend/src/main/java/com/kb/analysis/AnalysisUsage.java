package com.kb.analysis;

/** 一次 run 内的 AI 用量累计；本地模型无 usage 字段时全为 0。 */
public record AnalysisUsage(int calls, long promptTokens, long completionTokens) {

    public static final AnalysisUsage EMPTY = new AnalysisUsage(0, 0, 0);

    public AnalysisUsage add(AnalysisUsage other) {
        return new AnalysisUsage(calls + other.calls(),
                promptTokens + other.promptTokens(), completionTokens + other.completionTokens());
    }
}

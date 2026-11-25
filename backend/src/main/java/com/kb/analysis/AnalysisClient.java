package com.kb.analysis;

import java.util.Optional;

/** 可插拔 AI provider。任何实现都必须失败返回 empty，不允许抛异常打断调用方。 */
public interface AnalysisClient {

    Optional<AnalysisResult> analyze(AnalysisRequest request);

    String providerName();

    /** 最近一次调用的 token 用量；不支持统计的 provider 返回 EMPTY。 */
    default AnalysisUsage lastUsage() {
        return AnalysisUsage.EMPTY;
    }
}

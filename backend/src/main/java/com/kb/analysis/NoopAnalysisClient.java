package com.kb.analysis;

import java.util.Optional;

/** 默认 provider：零 HTTP 调用，保证不配置 key 时行为与今天完全一致。 */
public class NoopAnalysisClient implements AnalysisClient {

    @Override
    public Optional<AnalysisResult> analyze(AnalysisRequest request) {
        return Optional.empty();
    }

    @Override
    public String providerName() {
        return "none";
    }
}

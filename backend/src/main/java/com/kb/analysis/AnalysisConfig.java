package com.kb.analysis;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 按配置选择 provider；默认 Noop，保证零外呼。 */
@Configuration
public class AnalysisConfig {

    @Bean
    public AnalysisClient analysisClient(AnalysisProperties properties) {
        if (properties.isEnabled() && "openai-compatible".equals(properties.getProvider())
                && !properties.getBaseUrl().isBlank() && !properties.getModel().isBlank()) {
            return new OpenAiCompatibleAnalysisClient(properties);
        }
        return new NoopAnalysisClient();
    }
}

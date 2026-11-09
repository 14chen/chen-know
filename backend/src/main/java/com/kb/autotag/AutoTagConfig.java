package com.kb.autotag;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(AutoTagProperties.class)
public class AutoTagConfig {
}

package com.kb.archive;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(ArchiveProperties.class)
public class ArchiveConfig {
}

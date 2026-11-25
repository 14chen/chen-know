package com.kb.ops;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 每天 04:30 只清元数据表；与简报/周报/归档错峰。 */
@Component
public class RetentionScheduler {

    private final RetentionService service;
    private final RetentionProperties properties;

    public RetentionScheduler(RetentionService service, RetentionProperties properties) {
        this.service = service;
        this.properties = properties;
    }

    @Scheduled(cron = "${kb.retention.cron:0 30 4 * * *}")
    public void run() {
        if (!properties.isEnabled()) return;
        service.clean(false);
    }
}

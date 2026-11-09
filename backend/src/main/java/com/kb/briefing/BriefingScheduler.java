package com.kb.briefing;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * BRIEFING.md §5：定时触发。cron 可配（默认每天 18:30），与启动补抓共用
 * {@link BriefingService#runIfDue(String)}，因此「今天已跑过」只会跑一次。
 */
@Component
public class BriefingScheduler {

    private static final Logger log = LoggerFactory.getLogger(BriefingScheduler.class);

    private final BriefingService briefingService;

    public BriefingScheduler(BriefingService briefingService) {
        this.briefingService = briefingService;
    }

    @Scheduled(cron = "${kb.briefing.cron:0 30 18 * * *}")
    public void scheduled() {
        try {
            briefingService.runIfDue("cron");
        } catch (RuntimeException e) {
            log.warn("定时简报异常（不影响服务）: {}", e.getMessage(), e);
        }
    }
}

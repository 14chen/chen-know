package com.kb.briefing;

import java.util.concurrent.ExecutorService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 启动补抓：应用不是 24 小时开着的，18:30 那次经常错过。
 *
 * <p>应用就绪后在<b>后台单线程</b>里检查「今天是否已有成功/部分成功的 run + 是不是已过今天的生成时刻」，
 * 满足才补一次。失败只记 WARN，绝不影响启动。
 */
@Component
public class BriefingStartupCatchUp {

    private static final Logger log = LoggerFactory.getLogger(BriefingStartupCatchUp.class);

    private final BriefingService briefingService;
    private final ExecutorService briefingExecutor;

    public BriefingStartupCatchUp(BriefingService briefingService, ExecutorService briefingExecutor) {
        this.briefingService = briefingService;
        this.briefingExecutor = briefingExecutor;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        long queuedAt = System.currentTimeMillis();
        briefingExecutor.execute(() -> {
            try {
                briefingService.runIfDue("startup-catch-up");
            } catch (RuntimeException e) {
                log.warn("启动补抓失败（不影响服务启动）: {}", e.getMessage(), e);
            } finally {
                log.info("启动补抓检查结束，耗时 {} ms（后台线程，未阻塞启动）",
                        System.currentTimeMillis() - queuedAt);
            }
        });
    }
}

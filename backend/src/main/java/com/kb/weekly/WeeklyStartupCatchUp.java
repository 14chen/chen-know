package com.kb.weekly;

import java.util.concurrent.ExecutorService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 启动补抓：用户要求「现在就先出一份」。
 *
 * <p>所以<b>不看是不是周五、也不看时刻</b>，只看「当前 ISO 周还没成功跑过」——
 * 满足就跑一次；跑过就什么都不做。全程异步，绝不影响启动，失败只 WARN。
 */
@Component
public class WeeklyStartupCatchUp {

    private static final Logger log = LoggerFactory.getLogger(WeeklyStartupCatchUp.class);

    private final WeeklyService weeklyService;
    private final ExecutorService executor;

    public WeeklyStartupCatchUp(WeeklyService weeklyService, ExecutorService weeklyExecutor) {
        this.weeklyService = weeklyService;
        this.executor = weeklyExecutor;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        long started = System.currentTimeMillis();
        try {
            executor.execute(() -> {
                try {
                    weeklyService.runIfDue("startup-catch-up");
                } catch (RuntimeException e) {
                    log.warn("启动补抓周报失败（不影响启动）: {}", e.getMessage(), e);
                } finally {
                    log.info("启动补抓周报检查结束，耗时 {} ms（后台线程，未阻塞启动）",
                            System.currentTimeMillis() - started);
                }
            });
        } catch (RuntimeException e) {
            log.warn("提交启动补抓任务失败（不影响启动）: {}", e.getMessage());
        }
    }
}

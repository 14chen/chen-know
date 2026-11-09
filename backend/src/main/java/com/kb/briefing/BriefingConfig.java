package com.kb.briefing;

import java.time.Clock;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** BRIEFING.md §5：简报模块的配置装载、启动补抓线程与时钟。 */
@Configuration
@EnableConfigurationProperties(BriefingProperties.class)
public class BriefingConfig {

    /** 启动补抓专用：单线程、守护线程，绝不阻塞应用启动。 */
    @Bean(destroyMethod = "shutdownNow")
    public ExecutorService briefingExecutor() {
        return Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, "briefing-catch-up");
            thread.setDaemon(true);
            return thread;
        });
    }

    @Bean
    public Clock briefingClock() {
        return Clock.systemDefaultZone();
    }
}

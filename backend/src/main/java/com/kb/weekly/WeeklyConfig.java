package com.kb.weekly;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 周报的配置绑定与单线程执行器（启动补抓用，绝不阻塞启动）。 */
@Configuration
@EnableConfigurationProperties(WeeklyProperties.class)
public class WeeklyConfig {

    @Bean(destroyMethod = "shutdown")
    public ExecutorService weeklyExecutor() {
        return Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "weekly-catch-up");
            thread.setDaemon(true);
            return thread;
        });
    }

    // 注意：Clock 复用 briefing 模块已有的 bean，别再声明第二个（会造成依赖注入歧义）
}

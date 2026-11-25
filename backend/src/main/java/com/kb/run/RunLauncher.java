package com.kb.run;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** 异步运行载体：run 行已由业务服务插入（DB 锁已生效），这里只负责跑与记录进度。 */
@Component
public class RunLauncher {

    private static final Logger log = LoggerFactory.getLogger(RunLauncher.class);

    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final RunProgressRepository progress;

    public RunLauncher(RunProgressRepository progress) {
        this.progress = progress;
    }

    public long submit(String module, long spaceId, long runId, Runnable task) {
        progress.init(spaceId, module, runId);
        executor.submit(() -> {
            try {
                task.run();
            } catch (RuntimeException e) {
                log.warn("异步 {} run {} 失败: {}", module, runId, e.toString());
                progress.finish(spaceId, module, runId, "failed");
            }
        });
        return runId;
    }
}

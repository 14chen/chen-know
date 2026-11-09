package com.kb.archive;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 每天凌晨 04:15 归档（cron 可配）。 */
@Component
public class ArchiveScheduler {

    private final ArchiveService archiveService;

    public ArchiveScheduler(ArchiveService archiveService) {
        this.archiveService = archiveService;
    }

    @Scheduled(cron = "${kb.archive.cron:0 15 4 * * *}")
    public void runDaily() {
        archiveService.runIfDue("cron");
    }
}

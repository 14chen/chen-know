package com.kb.weekly;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 每周五 18:30 出周报（cron 可配）。 */
@Component
public class WeeklyScheduler {

    private final WeeklyService weeklyService;

    public WeeklyScheduler(WeeklyService weeklyService) {
        this.weeklyService = weeklyService;
    }

    @Scheduled(cron = "${kb.weekly.cron:0 30 18 * * FRI}")
    public void runWeekly() {
        weeklyService.runIfDue("cron");
    }
}

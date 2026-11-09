package com.kb.archive;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code kb.archive.*}：把「旧的」周目录与简报笔记搬进归档子目录（<b>只搬家，不删除</b>）。
 */
@ConfigurationProperties(prefix = "kb.archive")
public class ArchiveProperties {

    private boolean enabled = true;
    /** 最近多少周保留在周报根目录，更早的搬到 {@code 归档/}。 */
    private int weeklyKeepWeeks = 8;
    /** 简报保留多少天，更早的搬到 {@code AI简报归档/YYYY-MM/}。 */
    private int briefingKeepDays = 90;
    private String cron = "0 15 4 * * *";
    /** 周报根目录名（与 kb.weekly.folder 一致）。 */
    private String weeklyFolder = "开源周报";
    /** 周报根目录下的归档子目录名。 */
    private String weeklyArchiveFolder = "归档";
    /** 简报归档根目录名（下面再按 YYYY-MM 分）。 */
    private String briefingArchiveFolder = "AI简报归档";

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public int getWeeklyKeepWeeks() {
        return weeklyKeepWeeks < 0 ? 0 : weeklyKeepWeeks;
    }

    public void setWeeklyKeepWeeks(int weeklyKeepWeeks) {
        this.weeklyKeepWeeks = weeklyKeepWeeks;
    }

    public int getBriefingKeepDays() {
        return briefingKeepDays < 0 ? 0 : briefingKeepDays;
    }

    public void setBriefingKeepDays(int briefingKeepDays) {
        this.briefingKeepDays = briefingKeepDays;
    }

    public String getCron() {
        return cron;
    }

    public void setCron(String cron) {
        this.cron = cron;
    }

    public String getWeeklyFolder() {
        return weeklyFolder;
    }

    public void setWeeklyFolder(String weeklyFolder) {
        this.weeklyFolder = weeklyFolder;
    }

    public String getWeeklyArchiveFolder() {
        return weeklyArchiveFolder;
    }

    public void setWeeklyArchiveFolder(String weeklyArchiveFolder) {
        this.weeklyArchiveFolder = weeklyArchiveFolder;
    }

    public String getBriefingArchiveFolder() {
        return briefingArchiveFolder;
    }

    public void setBriefingArchiveFolder(String briefingArchiveFolder) {
        this.briefingArchiveFolder = briefingArchiveFolder;
    }
}

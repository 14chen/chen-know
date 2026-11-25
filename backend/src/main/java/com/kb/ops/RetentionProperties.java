package com.kb.ops;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** 元数据滚动保留期；只影响缓存/指标/健康等表，绝不影响笔记与运行历史。 */
@Component
@ConfigurationProperties(prefix = "kb.retention")
public class RetentionProperties {

    private boolean enabled = true;
    private String cron = "0 30 4 * * *";
    private int cacheDays = 90;
    private int seenDays = 180;
    private int metricsDays = 90;
    private int healthDays = 90;
    private int qualityDays = 90;
    private int aiDays = 90;
    private int weeklyDays = 400;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getCron() { return cron == null || cron.isBlank() ? "0 30 4 * * *" : cron; }
    public void setCron(String cron) { this.cron = cron; }
    private static int days(int value, int fallback) { return value <= 0 ? fallback : value; }
    public int getCacheDays() { return days(cacheDays, 90); }
    public void setCacheDays(int v) { cacheDays = v; }
    public int getSeenDays() { return days(seenDays, 180); }
    public void setSeenDays(int v) { seenDays = v; }
    public int getMetricsDays() { return days(metricsDays, 90); }
    public void setMetricsDays(int v) { metricsDays = v; }
    public int getHealthDays() { return days(healthDays, 90); }
    public void setHealthDays(int v) { healthDays = v; }
    public int getQualityDays() { return days(qualityDays, 90); }
    public void setQualityDays(int v) { qualityDays = v; }
    public int getAiDays() { return days(aiDays, 90); }
    public void setAiDays(int v) { aiDays = v; }
    public int getWeeklyDays() { return days(weeklyDays, 400); }
    public void setWeeklyDays(int v) { weeklyDays = v; }
}

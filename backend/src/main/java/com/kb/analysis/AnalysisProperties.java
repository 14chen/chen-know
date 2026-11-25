package com.kb.analysis;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** {@code kb.ai.*}：默认全关，地址与模型留空，强制显式配置后才可能外呼。 */
@Component
@ConfigurationProperties(prefix = "kb.ai")
public class AnalysisProperties {

    private boolean enabled = false;
    private String provider = "none";
    private String baseUrl = "";
    private String model = "";
    private int timeoutSeconds = 20;
    private int maxItemsPerRun = 20;
    private int maxRetries = 1;
    private int cacheTtlDays = 30;
    /** 每 100 万 token 单价；默认 0 = 只报 token、不报金额（避免编造成本）。 */
    private double priceInputPer1m = 0;
    private double priceOutputPer1m = 0;

    /** API key 只从环境变量读，绝不写进配置文件或日志。 */
    public String apiKey() {
        String key = System.getenv("KB_AI_API_KEY");
        return key == null ? "" : key.trim();
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getProvider() {
        return provider == null || provider.isBlank() ? "none" : provider.trim().toLowerCase();
    }

    public void setProvider(String provider) {
        this.provider = provider;
    }

    public String getBaseUrl() {
        return baseUrl == null ? "" : baseUrl.trim();
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getModel() {
        return model == null ? "" : model.trim();
    }

    public void setModel(String model) {
        this.model = model;
    }

    public int getTimeoutSeconds() {
        return Math.max(1, Math.min(120, timeoutSeconds));
    }

    public void setTimeoutSeconds(int timeoutSeconds) {
        this.timeoutSeconds = timeoutSeconds;
    }

    public int getMaxItemsPerRun() {
        return Math.max(0, Math.min(200, maxItemsPerRun));
    }

    public void setMaxItemsPerRun(int maxItemsPerRun) {
        this.maxItemsPerRun = maxItemsPerRun;
    }

    public int getMaxRetries() {
        return Math.max(0, Math.min(3, maxRetries));
    }

    public void setMaxRetries(int maxRetries) {
        this.maxRetries = maxRetries;
    }

    public int getCacheTtlDays() {
        return Math.max(1, cacheTtlDays);
    }

    public void setCacheTtlDays(int cacheTtlDays) {
        this.cacheTtlDays = cacheTtlDays;
    }

    public double getPriceInputPer1m() {
        return Math.max(0, priceInputPer1m);
    }

    public void setPriceInputPer1m(double priceInputPer1m) {
        this.priceInputPer1m = priceInputPer1m;
    }

    public double getPriceOutputPer1m() {
        return Math.max(0, priceOutputPer1m);
    }

    public void setPriceOutputPer1m(double priceOutputPer1m) {
        this.priceOutputPer1m = priceOutputPer1m;
    }
}

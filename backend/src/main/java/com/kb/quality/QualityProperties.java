package com.kb.quality;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** {@code kb.quality.*}：阈值、模板句清单、报告条数上限。 */
@Component
@ConfigurationProperties(prefix = "kb.quality")
public class QualityProperties {

    /** 默认清单来自真实库里出现的无效摘要；用户配置是「追加」而不是替换。 */
    static final List<String> DEFAULT_TEMPLATE_PATTERNS = List.of(
            "在 Hugging Face 上发布的博客文章",
            "我们正在通过开源和开放科学",
            "上发布的博客文章");

    private boolean enabled = true;
    private int threshold = 70;
    private List<String> extraPatterns = new ArrayList<>();
    private int reportLimit = 50;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public int getThreshold() {
        return Math.max(0, Math.min(100, threshold));
    }

    public void setThreshold(int threshold) {
        this.threshold = threshold;
    }

    public List<String> getTemplatePatterns() {
        List<String> all = new ArrayList<>(DEFAULT_TEMPLATE_PATTERNS);
        all.addAll(extraPatterns);
        return all;
    }

    /** 配置里的清单是追加项，默认实测清单永远保留。 */
    public void setTemplatePatterns(List<String> patterns) {
        this.extraPatterns = patterns == null ? new ArrayList<>() : new ArrayList<>(patterns);
    }

    public int getReportLimit() {
        return Math.max(1, Math.min(100, reportLimit));
    }

    public void setReportLimit(int reportLimit) {
        this.reportLimit = reportLimit;
    }
}

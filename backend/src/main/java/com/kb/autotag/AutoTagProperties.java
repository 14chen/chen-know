package com.kb.autotag;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code kb.autotag.*}。
 *
 * <p><b>默认关闭</b>：自动打错标签比不打更烦人，建议先观察一段时间再打开。
 */
@ConfigurationProperties(prefix = "kb.autotag")
public class AutoTagProperties {

    private boolean enabled = false;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }
}

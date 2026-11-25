package com.kb.config;

import com.kb.briefing.BriefingUrls;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** 把 SSRF DNS 校验开关接到配置；生产默认开启，测试用假域名时可关闭。 */
@Component
public class SsrfConfig {

    private final boolean dnsCheck;

    public SsrfConfig(@Value("${kb.security.ssrf-dns-check:true}") boolean dnsCheck) {
        this.dnsCheck = dnsCheck;
    }

    @PostConstruct
    public void apply() {
        BriefingUrls.setDnsCheckEnabled(dnsCheck);
    }
}

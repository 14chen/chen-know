package com.kb.quality;

import com.kb.user.KbPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 只读质量报告（BRIEFING/P1）：扫描历史缓存并给出不合格统计，不修改任何笔记。 */
@RestController
@RequestMapping("/api/quality")
public class QualityController {

    private final QualityReportService service;
    private final QualityProperties properties;

    public QualityController(QualityReportService service, QualityProperties properties) {
        this.service = service;
        this.properties = properties;
    }

    @GetMapping("/report")
    public QualityReportResponse report(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(defaultValue = "briefing") String module,
            @RequestParam(required = false) Integer limit) {
        int wanted = limit == null ? properties.getReportLimit() : Math.max(1, Math.min(100, limit));
        return service.report(principal.spaceId(), module, wanted);
    }
}

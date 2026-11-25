package com.kb.ops;

import com.kb.common.ApiException;
import com.kb.user.KbPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 只读运维端点：明细看自己空间，汇总仅管理员（避免跨空间暴露别人的统计）。 */
@RestController
@RequestMapping("/api/ops")
public class OpsController {

    private final RunMetricsService service;
    private final com.kb.briefing.SourceHealthService sourceHealth;

    public OpsController(RunMetricsService service, com.kb.briefing.SourceHealthService sourceHealth) {
        this.service = service;
        this.sourceHealth = sourceHealth;
    }

    @GetMapping("/runs")
    public List<RunMetrics> runs(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(required = false) String module,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Boolean all) {
        boolean allSpaces = Boolean.TRUE.equals(all) && principal.isAdmin();
        int wanted = limit == null ? 20 : Math.max(1, Math.min(200, limit));
        return service.list(principal.spaceId(), module, wanted, allSpaces);
    }

    /** 源健康明细：按空间隔离；当前仅简报有逐源抓取。 */
    @GetMapping("/sources")
    public java.util.List<com.kb.briefing.SourceHealth> sources(
            @AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(required = false) String module) {
        if (module != null && !module.isBlank() && !"briefing".equals(module)) {
            throw ApiException.validation("module 目前只支持 briefing", "module");
        }
        return sourceHealth.list(principal.spaceId());
    }

    @GetMapping("/summary")
    public RunMetricsService.Summary summary(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(required = false) String module,
            @RequestParam(required = false) Integer days) {
        if (!principal.isAdmin()) {
            throw ApiException.forbidden("运行汇总仅管理员可见");
        }
        return service.summary(principal.isAdmin() ? 0 : principal.spaceId(), module, days == null ? 7 : days);
    }
}

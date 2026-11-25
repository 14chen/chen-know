package com.kb.run;

import com.kb.common.ApiException;
import com.kb.user.KbPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 通用进度/取消端点：module 用路径区分 briefing / weekly。 */
@RestController
@RequestMapping("/api/runs")
public class RunController {

    private final RunProgressRepository progress;

    public RunController(RunProgressRepository progress) {
        this.progress = progress;
    }

    public record OkResponse(boolean ok) {
    }

    @GetMapping("/{module}/{runId}/progress")
    public RunProgress get(@AuthenticationPrincipal KbPrincipal principal,
            @PathVariable String module, @PathVariable long runId) {
        return progress.get(principal.spaceId(), module, runId)
                .orElseThrow(() -> ApiException.notFound("运行进度不存在"));
    }

    @PostMapping("/{module}/{runId}/cancel")
    public OkResponse cancel(@AuthenticationPrincipal KbPrincipal principal,
            @PathVariable String module, @PathVariable long runId) {
        progress.cancel(principal.spaceId(), module, runId);
        return new OkResponse(true);
    }
}

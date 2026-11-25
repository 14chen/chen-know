package com.kb.weekly;

import com.kb.user.KbPrincipal;
import org.springframework.http.ResponseEntity;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 开源周报接口：只归档到调用者自己的空间。 */
@RestController
@RequestMapping("/api/weekly")
public class WeeklyController {

    private final WeeklyService weeklyService;

    public WeeklyController(WeeklyService weeklyService) {
        this.weeklyService = weeklyService;
    }

    public record RunsResponse(List<WeeklyRepository.Run> items) {
    }

    /** 同步仍是默认；?async=true 返回 202 + runId。 */
    @PostMapping("/run")
    public ResponseEntity<?> run(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(name = "async", required = false) Boolean async) {
        if (Boolean.TRUE.equals(async)) {
            long runId = weeklyService.runAsync(principal.id(), principal.spaceId(), "manual-async");
            return ResponseEntity.accepted().body(new AsyncResponse(runId, "running"));
        }
        return ResponseEntity.ok(weeklyService.run(principal.id(), principal.spaceId()));
    }

    public record AsyncResponse(long runId, String status) {
    }

    /** 异步 run 完成后，前端据此还原原有的 banner 文案。 */
    @GetMapping("/runs/{id}")
    public WeeklyRepository.Run runById(@AuthenticationPrincipal KbPrincipal principal,
            @PathVariable long id) {
        return weeklyService.recentRunById(principal.spaceId(), id);
    }

    @GetMapping("/runs")
    public RunsResponse runs(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(name = "limit", defaultValue = "10") int limit) {
        int capped = Math.max(1, Math.min(limit, 100));
        return new RunsResponse(weeklyService.recent(principal.spaceId(), capped));
    }
}

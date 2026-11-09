package com.kb.weekly;

import com.kb.user.KbPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
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

    @PostMapping("/run")
    public WeeklyService.RunResponse run(@AuthenticationPrincipal KbPrincipal principal) {
        return weeklyService.run(principal.id(), principal.spaceId());
    }

    @GetMapping("/runs")
    public RunsResponse runs(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(name = "limit", defaultValue = "10") int limit) {
        int capped = Math.max(1, Math.min(limit, 100));
        return new RunsResponse(weeklyService.recent(principal.spaceId(), capped));
    }
}

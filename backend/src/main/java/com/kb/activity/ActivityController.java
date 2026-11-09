package com.kb.activity;

import com.kb.user.KbPrincipal;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** API.md §9：{@code /api/notes/{id}/view}、{@code /api/recent}、{@code /api/stats}。 */
@RestController
public class ActivityController {

    private final ActivityService activityService;

    public ActivityController(ActivityService activityService) {
        this.activityService = activityService;
    }

    @PostMapping("/api/notes/{id}/view")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void recordView(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        activityService.recordView(principal, id);
    }

    @GetMapping("/api/recent")
    public RecentResponse recent(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(name = "limit", defaultValue = "20") int limit) {
        return activityService.recent(principal, limit);
    }

    @GetMapping("/api/stats")
    public StatsResponse stats(@AuthenticationPrincipal KbPrincipal principal) {
        return activityService.stats(principal);
    }
}

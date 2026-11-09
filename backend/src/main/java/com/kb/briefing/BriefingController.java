package com.kb.briefing;

import com.kb.user.KbPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** BRIEFING.md §6：简报接口。只归档到调用者自己的空间，不接受 spaceId 参数。 */
@RestController
@RequestMapping("/api/briefing")
public class BriefingController {

    private final BriefingService briefingService;
    private final BriefingFetcherRegistry registry;
    private final BriefingRepository repository;
    private final BriefingProperties properties;

    public BriefingController(BriefingService briefingService, BriefingFetcherRegistry registry,
            BriefingRepository repository, BriefingProperties properties) {
        this.briefingService = briefingService;
        this.registry = registry;
        this.repository = repository;
        this.properties = properties;
    }

    @PostMapping("/run")
    public BriefingRunResponse run(@AuthenticationPrincipal KbPrincipal principal) {
        return briefingService.run(principal.id(), principal.spaceId());
    }

    @GetMapping("/runs")
    public BriefingRunsResponse runs(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(name = "limit", defaultValue = "10") int limit) {
        int capped = Math.max(1, Math.min(limit, 100));
        List<BriefingRunView> items = repository.recent(principal.spaceId(), capped).stream()
                .map(run -> new BriefingRunView(run.id(), run.startedAt(), run.finishedAt(), run.status(),
                        run.totalItems(), run.newItems(), run.noteId(),
                        BriefingService.parseReport(run.sourceReport())))
                .toList();
        return new BriefingRunsResponse(items);
    }

    @GetMapping("/sources")
    public BriefingSourcesResponse sources() {
        return new BriefingSourcesResponse(registry.sources().stream()
                .map(source -> properties.isSkipped(source.id())
                        ? BriefingSourceView.of(source, true, BriefingService.SKIPPED_REASON)
                        : BriefingSourceView.of(source, false, null))
                .toList());
    }
}

package com.kb.archive;

import com.kb.user.KbPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 归档接口：只处理调用者自己的空间。 */
@RestController
@RequestMapping("/api/archive")
public class ArchiveController {

    private final ArchiveService archiveService;

    public ArchiveController(ArchiveService archiveService) {
        this.archiveService = archiveService;
    }

    public record RunsResponse(List<ArchiveRepository.Run> items) {
    }

    @PostMapping("/run")
    public ArchiveService.Result run(@AuthenticationPrincipal KbPrincipal principal) {
        return archiveService.run(principal.spaceId());
    }

    @GetMapping("/runs")
    public RunsResponse runs(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(name = "limit", defaultValue = "10") int limit) {
        return new RunsResponse(archiveService.recent(principal.spaceId(), Math.max(1, Math.min(limit, 100))));
    }
}

package com.kb.weekly;

import com.kb.user.KbPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 周报体验 API：历史周、周总览、星增序列、项目档案。note 正文格式不变。 */
@RestController
@RequestMapping("/api/weekly")
public class WeeklyExperienceController {

    private final WeeklyExperienceService service;
    private final WeeklyExperienceRepository repository;

    public WeeklyExperienceController(WeeklyExperienceService service, WeeklyExperienceRepository repository) {
        this.service = service;
        this.repository = repository;
    }

    @GetMapping("/weeks")
    public List<WeeklyExperienceRepository.WeekRow> weeks(@AuthenticationPrincipal KbPrincipal principal) {
        return service.weeks(principal.spaceId());
    }

    @GetMapping("/week/{isoWeek}")
    public WeeklyExperienceService.WeekDetail week(@AuthenticationPrincipal KbPrincipal principal,
            @PathVariable String isoWeek) {
        return service.weekDetail(principal.spaceId(), isoWeek);
    }

    /** 用查询参数而非路径参数：owner/repo 里的斜杠不会被 URL 编码问题截断。 */
    @GetMapping("/repos/stars")
    public List<WeeklyExperienceRepository.StarPoint> stars(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam String source, @RequestParam String repo,
            @RequestParam(required = false) Integer weeks) {
        return repository.starHistory(principal.spaceId(), source, repo, weeks == null ? 8 : weeks);
    }

    @GetMapping("/profiles")
    public List<WeeklyExperienceRepository.Profile> profiles(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(required = false) String source, @RequestParam(required = false) String repo) {
        if (source != null && repo != null) {
            return repository.profile(principal.spaceId(), source, repo).map(List::of).orElseGet(List::of);
        }
        return List.of();
    }
}

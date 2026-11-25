package com.kb.briefing;

import com.kb.common.ApiException;
import com.kb.common.PageResponse;
import com.kb.common.Times;
import com.kb.user.KbPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 简报体验 API：跑批明细、条目分页、反馈。note 正文格式完全不变。 */
@RestController
@RequestMapping("/api/briefing")
public class BriefingExperienceController {

    private final BriefingRepository runs;
    private final BriefingItemRepository items;

    public BriefingExperienceController(BriefingRepository runs, BriefingItemRepository items) {
        this.runs = runs;
        this.items = items;
    }

    public record RunDetail(BriefingRun run, List<BriefingItem> items) {
    }

    public record FeedbackRequest(String url, String feedback) {
    }

    public record OkResponse(boolean ok) {
    }

    @GetMapping("/runs/{id}")
    public RunDetail runDetail(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        BriefingRun run = runs.findById(principal.spaceId(), id)
                .orElseThrow(() -> ApiException.notFound("运行记录不存在"));
        return new RunDetail(run, items.listByRun(principal.spaceId(), id));
    }

    @GetMapping("/items")
    public PageResponse<BriefingItem> listItems(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(required = false) Long runId,
            @RequestParam(required = false) String theme,
            @RequestParam(required = false) Integer minScore,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        int pageNumber = PageResponse.normalizePage(page);
        int pageSize = PageResponse.normalizeSize(size);
        List<BriefingItem> result = items.list(principal.spaceId(), runId, theme, minScore, q,
                pageNumber, pageSize);
        return PageResponse.of(result, pageNumber, pageSize, result.size());
    }

    @PostMapping("/items/feedback")
    public OkResponse feedback(@AuthenticationPrincipal KbPrincipal principal,
            @RequestBody FeedbackRequest body) {
        if (body == null || body.url() == null || body.url().isBlank()) {
            throw ApiException.validation("url 不能为空", "url");
        }
        String value = body.feedback() == null ? "" : body.feedback().trim();
        if (!"useful".equals(value) && !"not_interesting".equals(value)) {
            throw ApiException.validation("feedback 只能是 useful 或 not_interesting", "feedback");
        }
        items.upsertFeedback(principal.spaceId(), principal.id(), body.url().trim(), value, Times.now());
        return new OkResponse(true);
    }
}

package com.kb.search;

import com.kb.common.PageResponse;
import com.kb.user.KbPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** API.md §5 搜索。 */
@RestController
@RequestMapping("/api/search")
public class SearchController {

    private final SearchService searchService;
    private final SuggestService suggestService;

    public SearchController(SearchService searchService, SuggestService suggestService) {
        this.searchService = searchService;
        this.suggestService = suggestService;
    }

    /** 搜索联想词（只读）：先标签（≤3 个），再用标题补满。 */
    @GetMapping("/suggest")
    public SuggestResponse suggest(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Integer limit) {
        return new SuggestResponse(suggestService.suggest(principal.spaceId(), q,
                limit == null ? SuggestService.DEFAULT_LIMIT : limit));
    }

    /** 联想词响应体：{"items": [{"text":.., "kind":..}]}。 */
    public record SuggestResponse(java.util.List<SuggestItem> items) {
    }

    @GetMapping
    public PageResponse<SearchHit> search(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false) Long tagId,
            @RequestParam(required = false) Long folderId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return searchService.search(principal.spaceId(),
                SearchQuery.of(q, tag, tagId, folderId, from, to, sort, page, size));
    }
}

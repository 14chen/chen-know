package com.kb.note;

import com.kb.common.PageResponse;
import com.kb.tag.SetNoteTagsRequest;
import com.kb.user.KbPrincipal;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * API.md §4 笔记接口。
 *
 * <p>回滚端点也在这里（{@code POST /{id}/versions/{version}/restore}）：它要写正文、
 * 重算 excerpt/search_blob 并重建 links，与笔记写路径同源；
 * 只读的版本列表与全文在 {@code com.kb.history.VersionController}。
 */
@RestController
@RequestMapping("/api/notes")
public class NoteController {

    private final NoteService noteService;
    private final com.kb.related.RelatedService relatedService;

    public NoteController(NoteService noteService, com.kb.related.RelatedService relatedService) {
        this.noteService = noteService;
        this.relatedService = relatedService;
    }

    @GetMapping
    public PageResponse<NoteListItem> list(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(required = false) Long folderId,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Boolean favorite,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return noteService.list(principal.spaceId(), NoteQuery.of(folderId, tag, q, favorite, sort, page, size));
    }

    /** 相关推荐（只读）：同标签 → 同目录 → 内容相近。 */
    @GetMapping("/{id}/related")
    public RelatedResponse related(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id,
            @RequestParam(name = "limit", defaultValue = "5") int limit) {
        return new RelatedResponse(relatedService.related(principal.spaceId(), id, limit));
    }

    /** 相关推荐的响应体：{@code {"items": [...]}}。 */
    public record RelatedResponse(java.util.List<com.kb.related.RelatedItem> items) {
    }

    @GetMapping("/{id}")
    public NoteDetail detail(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        return noteService.detail(principal.spaceId(), id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public NoteDetail create(@AuthenticationPrincipal KbPrincipal principal,
            @Valid @RequestBody CreateNoteRequest request) {
        return noteService.create(principal.id(), principal.spaceId(), request);
    }

    @PatchMapping("/{id}")
    public NoteDetail patch(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id,
            @RequestBody Map<String, Object> body) {
        return noteService.patch(principal.id(), principal.spaceId(), id, NotePatch.from(body));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        noteService.delete(principal.id(), principal.spaceId(), id);
    }

    @PutMapping("/{id}/tags")
    public NoteDetail setTags(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id,
            @Valid @RequestBody SetNoteTagsRequest request) {
        return noteService.setTags(principal.spaceId(), id, request.tagNames());
    }

    @PostMapping("/{id}/versions/{version}/restore")
    public NoteDetail restore(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id,
            @PathVariable int version) {
        return noteService.restore(principal.id(), principal.spaceId(), id, version);
    }
}

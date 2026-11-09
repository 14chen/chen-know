package com.kb.tag;

import com.kb.user.KbPrincipal;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * API.md §6 标签接口。
 *
 * <p>{@code GET} 返回裸数组（API.md §0.3 明确把 {@code /api/tags} 列在分页信封的例外里）。
 * {@code PUT /api/notes/{id}/tags} 走笔记控制器（{@code com.kb.note.NoteController}），
 * 因为它返回笔记详情且需要笔记仓储参与。
 */
@RestController
@RequestMapping("/api/tags")
public class TagController {

    private final TagService tagService;

    public TagController(TagService tagService) {
        this.tagService = tagService;
    }

    @GetMapping
    public List<TagResponse> list(@AuthenticationPrincipal KbPrincipal principal) {
        return tagService.list(principal.spaceId());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public TagResponse create(@AuthenticationPrincipal KbPrincipal principal,
            @Valid @RequestBody CreateTagRequest request) {
        return tagService.create(principal.spaceId(), request);
    }

    @PatchMapping("/{id}")
    public TagResponse update(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id,
            @Valid @RequestBody UpdateTagRequest request) {
        return tagService.update(principal.spaceId(), id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        tagService.delete(principal.spaceId(), id);
    }
}

package com.kb.note;

import com.kb.common.PageResponse;
import com.kb.user.KbPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * API.md §4.3 {@code GET /api/favorites}：分页信封，items 元素与 {@code GET /api/notes} 列表项完全一致。
 * 与列共同一条查询路径，只是固定 {@code is_favorite = 1}。
 */
@RestController
public class FavoritesController {

    private final NoteService noteService;

    public FavoritesController(NoteService noteService) {
        this.noteService = noteService;
    }

    @GetMapping("/api/favorites")
    public PageResponse<NoteListItem> favorites(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(required = false) Long folderId,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return noteService.list(principal.spaceId(), NoteQuery.favorites(folderId, page, size));
    }
}

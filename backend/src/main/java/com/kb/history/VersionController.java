package com.kb.history;

import com.kb.user.KbPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * API.md §4 版本读取端点。
 *
 * <p>{@code POST /api/notes/{id}/versions/{version}/restore} 不在这里：
 * 回滚要写正文、重算 excerpt/search_blob 并重建双向链接，与笔记写路径同源，
 * 因此由 {@code com.kb.note.NoteController} 提供（避免包间循环依赖）。
 */
@RestController
@RequestMapping("/api/notes/{noteId}/versions")
public class VersionController {

    private final VersionService versionService;

    public VersionController(VersionService versionService) {
        this.versionService = versionService;
    }

    @GetMapping
    public List<VersionSummary> list(@AuthenticationPrincipal KbPrincipal principal,
            @PathVariable long noteId) {
        return versionService.list(principal.spaceId(), noteId);
    }

    @GetMapping("/{version}")
    public VersionDetail get(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long noteId,
            @PathVariable int version) {
        return versionService.get(principal.spaceId(), noteId, version);
    }
}

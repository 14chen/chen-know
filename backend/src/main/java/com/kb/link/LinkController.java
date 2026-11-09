package com.kb.link;

import com.kb.user.KbPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** API.md §4.1 出链 / 反链。 */
@RestController
@RequestMapping("/api/notes/{noteId}")
public class LinkController {

    private final LinkService linkService;

    public LinkController(LinkService linkService) {
        this.linkService = linkService;
    }

    @GetMapping("/links")
    public LinkView links(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long noteId) {
        return linkService.outlinks(principal.spaceId(), noteId);
    }

    @GetMapping("/backlinks")
    public BacklinkView backlinks(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long noteId) {
        return linkService.backlinks(principal.spaceId(), noteId);
    }
}

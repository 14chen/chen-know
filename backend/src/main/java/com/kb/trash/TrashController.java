package com.kb.trash;

import com.kb.user.KbPrincipal;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** API.md §8 回收站接口。 */
@RestController
@RequestMapping("/api/trash")
public class TrashController {

    private final TrashService trashService;

    public TrashController(TrashService trashService) {
        this.trashService = trashService;
    }

    @GetMapping
    public TrashResponse list(@AuthenticationPrincipal KbPrincipal principal) {
        return trashService.list(principal);
    }

    @PostMapping("/notes/{id}/restore")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void restoreNote(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        trashService.restoreNote(principal, id);
    }

    @PostMapping("/folders/{id}/restore")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void restoreFolder(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        trashService.restoreFolder(principal, id);
    }

    @DeleteMapping("/notes/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void purgeNote(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        trashService.purgeNote(principal, id);
    }

    @DeleteMapping("/folders/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void purgeFolder(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        trashService.purgeFolder(principal, id);
    }

    @PostMapping("/empty")
    public EmptyTrashResponse empty(@AuthenticationPrincipal KbPrincipal principal) {
        return trashService.empty(principal);
    }
}

package com.kb.folder;

import com.kb.user.KbPrincipal;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** API.md §3 目录接口。 */
@RestController
@RequestMapping("/api/folders")
public class FolderController {

    private final FolderService folderService;

    public FolderController(FolderService folderService) {
        this.folderService = folderService;
    }

    @GetMapping
    public List<FolderNode> list(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(name = "tree", defaultValue = "true") boolean tree) {
        return folderService.list(principal.spaceId(), tree);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public FolderNode create(@AuthenticationPrincipal KbPrincipal principal,
            @Valid @RequestBody CreateFolderRequest request) {
        return folderService.create(principal.spaceId(), request);
    }

    @PatchMapping("/{id}")
    public FolderNode update(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id,
            @RequestBody Map<String, Object> body) {
        return folderService.patch(principal.spaceId(), id, FolderPatch.from(body));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        folderService.delete(principal.spaceId(), id);
    }
}

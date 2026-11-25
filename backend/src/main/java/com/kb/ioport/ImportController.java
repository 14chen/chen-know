package com.kb.ioport;

import com.kb.user.KbPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** API.md §10 导入接口：multipart 里可以有多个名为 {@code file} 的部件。 */
@RestController
@RequestMapping("/api/import")
public class ImportController {

    private final ImportService importService;

    public ImportController(ImportService importService) {
        this.importService = importService;
    }

    @PostMapping("/preview")
    public ImportPreviewResponse preview(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(value = "file", required = false) MultipartFile[] files,
            @RequestParam(value = "targetFolderId", required = false) Long targetFolderId) {
        return importService.preview(principal, files, targetFolderId);
    }

    @PostMapping("/markdown")
    public ImportResult importMarkdown(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(value = "file", required = false) MultipartFile[] files,
            @RequestParam(value = "targetFolderId", required = false) Long targetFolderId) {
        return importService.importMarkdown(principal, files, targetFolderId);
    }
}

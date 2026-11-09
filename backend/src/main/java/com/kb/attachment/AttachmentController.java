package com.kb.attachment;

import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import com.kb.user.KbPrincipal;

/** API.md §7 附件接口。空间隔离由各方法内的 space_id 条件保证。 */
@RestController
@RequestMapping("/api/attachments")
public class AttachmentController {

    private final AttachmentService attachmentService;

    public AttachmentController(AttachmentService attachmentService) {
        this.attachmentService = attachmentService;
    }

    /** {@code file} 声明为可选，缺失时由服务层回 400（而非容器异常导致 500）。 */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AttachmentResponse upload(@AuthenticationPrincipal KbPrincipal principal,
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "noteId", required = false) Long noteId) {
        return attachmentService.upload(principal, file, noteId);
    }

    /** 附件体检：表里有但文件没了 / 磁盘上有但表里没有。 */
    @GetMapping("/health")
    public AttachmentHealth health(@AuthenticationPrincipal KbPrincipal principal) {
        return attachmentService.health(principal);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Resource> download(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        return attachmentService.download(principal, id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        attachmentService.delete(principal, id);
    }
}

package com.kb.ioport;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.kb.user.KbPrincipal;
import jakarta.servlet.http.HttpServletResponse;

/** API.md §10 导出接口。 */
@RestController
@RequestMapping("/api/export")
public class ExportController {

    private final ExportService exportService;

    public ExportController(ExportService exportService) {
        this.exportService = exportService;
    }

    /**
     * 契约路径是 {@code /notes/{id}.md}，同时接受不带扩展名的写法。
     * 行为保持不变（API.md §10：「仅正文，不含附件」，界面不再使用，脚本可能仍在用）。
     */
    @GetMapping({"notes/{id}", "notes/{id}.md"})
    public ResponseEntity<byte[]> exportNote(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id) {
        ExportedNote note = exportService.exportNote(principal, id);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(new MediaType("text", "markdown", StandardCharsets.UTF_8));
        headers.setContentLength(note.content().length);
        headers.set(HttpHeaders.CONTENT_DISPOSITION, FileNames.attachmentDisposition(note.fileName()));
        return new ResponseEntity<>(note.content(), headers, HttpStatus.OK);
    }

    /** API.md §10.0：单篇导出为 ZIP（界面用这个）—— 只含该篇正文实际引用到的附件。 */
    @GetMapping("notes/{id}.zip")
    public void exportNoteZip(@AuthenticationPrincipal KbPrincipal principal, @PathVariable long id,
            HttpServletResponse response) throws IOException {
        exportService.exportNoteZip(principal, id, response);
    }

    @GetMapping("/all")
    public void exportAll(@AuthenticationPrincipal KbPrincipal principal, HttpServletResponse response)
            throws IOException {
        exportService.exportAll(principal, response);
    }
}

package com.kb.ioport;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import org.springframework.web.multipart.MultipartFile;

/**
 * 把索引里的 {@code byte[]} 包成 {@link MultipartFile}，好让导入走
 * {@code AttachmentService.upload(...)}（IMPORT-IMAGES.md §4：不得绕过它的 20 MB 上限与 MIME 白名单）。
 *
 * <p>{@code contentType} 故意留空：由 AttachmentService 按 {@code originalName} 的扩展名判定并校验白名单，
 * 避免白名单在 ioport 里再抄一份。
 */
final class ByteMultipartFile implements MultipartFile {

    private final String originalFilename;
    private final byte[] content;

    ByteMultipartFile(String originalFilename, byte[] content) {
        this.originalFilename = originalFilename;
        this.content = content == null ? new byte[0] : content;
    }

    @Override
    public String getName() {
        return "file";
    }

    @Override
    public String getOriginalFilename() {
        return originalFilename;
    }

    @Override
    public String getContentType() {
        return null;
    }

    @Override
    public boolean isEmpty() {
        return content.length == 0;
    }

    @Override
    public long getSize() {
        return content.length;
    }

    @Override
    public byte[] getBytes() {
        return content;
    }

    @Override
    public InputStream getInputStream() {
        return new ByteArrayInputStream(content);
    }

    @Override
    public void transferTo(File dest) throws IOException {
        Files.write(dest.toPath(), content);
    }
}

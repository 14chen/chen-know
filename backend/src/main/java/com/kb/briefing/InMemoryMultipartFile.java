package com.kb.briefing;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import org.springframework.web.multipart.MultipartFile;

/**
 * 把下载到的图片字节喂给现有的 {@code AttachmentService.upload}（复用附件白名单、
 * 服务端落盘命名、20 MB 上限、SHA-256 记录），不自己写文件存储。
 */
final class InMemoryMultipartFile implements MultipartFile {

    private final byte[] content;
    private final String name;
    private final String contentType;

    InMemoryMultipartFile(byte[] content, String name, String contentType) {
        this.content = content;
        this.name = name;
        this.contentType = contentType;
    }

    @Override
    public String getName() {
        return "file";
    }

    @Override
    public String getOriginalFilename() {
        return name;
    }

    @Override
    public String getContentType() {
        return contentType;
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
        return content.clone();
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

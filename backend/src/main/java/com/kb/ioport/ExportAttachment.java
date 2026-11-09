package com.kb.ioport;

/** 导出用的附件行；{@code storedName} 是 uploads 目录下的相对路径。 */
public record ExportAttachment(long id, Long noteId, String storedName, String originalName, String mimeType,
        long sizeBytes, String sha256) {
}

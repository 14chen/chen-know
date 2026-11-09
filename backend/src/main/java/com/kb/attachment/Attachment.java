package com.kb.attachment;

/** {@code attachments} 表的一行。{@code storedName} 是 uploads 目录下的相对路径，形如 {@code 7/<uuid>.png}。 */
public record Attachment(
        long id,
        long spaceId,
        Long noteId,
        String storedName,
        String originalName,
        String mimeType,
        long sizeBytes,
        String sha256,
        String createdAt) {
}

package com.kb.attachment;

/** API.md §7 POST 201 响应体。 */
public record AttachmentResponse(long id, String url, String originalName, String mimeType, long sizeBytes) {

    static AttachmentResponse of(Attachment attachment) {
        return new AttachmentResponse(attachment.id(), "/api/attachments/" + attachment.id(),
                attachment.originalName(), attachment.mimeType(), attachment.sizeBytes());
    }
}

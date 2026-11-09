package com.kb.ioport;

/** 导出用的笔记行（仅未删除）。 */
public record ExportNote(long id, Long folderId, String title, String content, String createdAt, String updatedAt) {
}

package com.kb.attachment;

import java.util.List;

/**
 * GET /api/attachments/health：附件体检（只扫当前空间）。
 *
 * @param missingItems 表里有记录但磁盘文件不在了（编辑器里表现为「图片显示不出来」）
 * @param orphans 磁盘上有文件但表里没记录
 */
public record AttachmentHealth(int total, int ok, int missing, List<MissingItem> missingItems,
        List<OrphanItem> orphans) {

    /** @param noteTitle 关联笔记标题（笔记已删则为 null） */
    public record MissingItem(long id, Long noteId, String noteTitle, String originalName, long sizeBytes) {
    }

    public record OrphanItem(String storedName, long sizeBytes) {
    }
}

package com.kb.folder;

import java.util.List;

/**
 * API.md §3 树节点：{@code {id, parentId, name, sortOrder, noteCount, children}}。
 *
 * <p>{@code noteCount} 只统计**直属**未删除笔记（契约 §3 已固化），与
 * {@code GET /api/notes?folderId=<id>} 的 total 同源同口径。
 * 扁平模式（{@code tree=false}）下 {@code children} 为空数组，前端无需判空。
 */
public record FolderNode(long id, Long parentId, String name, int sortOrder, long noteCount,
        List<FolderNode> children) {
}

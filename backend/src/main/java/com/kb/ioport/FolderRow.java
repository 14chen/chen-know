package com.kb.ioport;

/** 导出用的目录行，用于重建 {@code notes/目录路径/标题.md} 的层级。 */
public record FolderRow(long id, Long parentId, String name) {
}

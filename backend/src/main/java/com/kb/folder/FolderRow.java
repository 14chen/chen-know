package com.kb.folder;

/** folders 表的一行（只取业务需要的列）。 */
public record FolderRow(long id, Long parentId, String name, int sortOrder) {
}

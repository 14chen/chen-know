package com.kb.trash;

/** 回收站里的目录条目。{@code noteCount} = 同一次删除里随它一起进回收站的笔记数。 */
public record TrashFolderItem(long id, Long parentId, String name, String deletedAt, long noteCount) {
}

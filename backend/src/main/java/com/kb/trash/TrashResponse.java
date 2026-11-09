package com.kb.trash;

import java.util.List;

/** API.md §8 GET /api/trash 响应：两个数组各自按 deletedAt 倒序。 */
public record TrashResponse(List<TrashNoteItem> notes, List<TrashFolderItem> folders) {
}

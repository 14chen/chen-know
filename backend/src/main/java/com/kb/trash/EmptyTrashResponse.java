package com.kb.trash;

/** API.md §8 POST /api/trash/empty 响应。 */
public record EmptyTrashResponse(long deletedNotes, long deletedFolders) {
}

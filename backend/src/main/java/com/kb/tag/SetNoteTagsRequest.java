package com.kb.tag;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/** PUT /api/notes/{id}/tags 请求体：覆盖式设置（API.md §6）。 */
public record SetNoteTagsRequest(@NotNull(message = "tagNames 不能为空") List<String> tagNames) {
}

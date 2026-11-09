package com.kb.folder;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** POST /api/folders 请求体（API.md §3）。{@code parentId} 为 null 表示建在根。 */
public record CreateFolderRequest(
        Long parentId,

        @NotBlank(message = "目录名不能为空")
        @Size(max = 128, message = "目录名最长 128 字")
        String name) {
}

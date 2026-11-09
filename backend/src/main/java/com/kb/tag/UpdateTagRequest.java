package com.kb.tag;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** PATCH /api/tags/{id} 请求体（API.md §6）：字段全可选，null 表示不改。 */
public record UpdateTagRequest(
        @Size(max = 64, message = "标签名最长 64 字")
        String name,

        @Pattern(regexp = "#[0-9a-fA-F]{6}", message = "颜色需为 #RRGGBB 形式")
        String color) {
}

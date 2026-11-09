package com.kb.tag;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** POST /api/tags 请求体（API.md §6）。 */
public record CreateTagRequest(
        @NotBlank(message = "标签名不能为空")
        @Size(max = 64, message = "标签名最长 64 字")
        String name,

        @Pattern(regexp = "#[0-9a-fA-F]{6}", message = "颜色需为 #RRGGBB 形式")
        String color) {
}

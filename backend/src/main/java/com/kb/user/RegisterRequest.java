package com.kb.user;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** POST /api/auth/register 请求体（API.md §1）。 */
public record RegisterRequest(
        @NotBlank(message = "用户名不能为空")
        @Pattern(regexp = "[A-Za-z0-9_-]{3,32}", message = "用户名需为 3-32 位字母、数字、下划线或短横线")
        String username,

        @NotBlank(message = "显示名不能为空")
        @Size(min = 1, max = 32, message = "显示名需为 1-32 字")
        String displayName,

        @NotBlank(message = "密码不能为空")
        @Size(min = 8, max = 72, message = "密码需为 8-72 位")
        String password,

        String inviteCode) {
}

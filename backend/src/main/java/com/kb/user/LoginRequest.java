package com.kb.user;

import jakarta.validation.constraints.NotBlank;

/** POST /api/auth/login 请求体。 */
public record LoginRequest(
        @NotBlank(message = "用户名不能为空") String username,
        @NotBlank(message = "密码不能为空") String password) {
}

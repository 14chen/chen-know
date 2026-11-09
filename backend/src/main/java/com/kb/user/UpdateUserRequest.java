package com.kb.user;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** PATCH /api/admin/users/{id} 请求体；字段为 null 表示不改。 */
public record UpdateUserRequest(
        @Size(min = 1, max = 32, message = "显示名需为 1-32 字") String displayName,

        @Size(min = 8, max = 72, message = "密码需为 8-72 位") String password,

        @Pattern(regexp = "admin|member", message = "角色只能是 admin 或 member") String role,

        Boolean disabled) {
}

package com.kb.user;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/** POST /api/admin/invites 请求体；{@code expiresInHours} 为 null 表示永不过期。 */
public record CreateInviteRequest(
        @Min(value = 1, message = "有效期至少 1 小时")
        @Max(value = 8760, message = "有效期最多 8760 小时")
        Integer expiresInHours) {
}

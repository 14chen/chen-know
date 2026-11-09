package com.kb.user;

/** GET /api/admin/users 列表项。契约未细化字段，这里给出前端管理页需要的全部内容。 */
public record AdminUserResponse(
        long id,
        String username,
        String displayName,
        String role,
        boolean disabled,
        String createdAt,
        Long spaceId) {
}

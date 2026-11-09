package com.kb.user;

/** POST /api/admin/invites 响应（API.md §2）：{@code {code, expiresAt}}。 */
public record CreateInviteResponse(String code, String expiresAt) {
}

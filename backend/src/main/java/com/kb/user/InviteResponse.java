package com.kb.user;

import java.time.Instant;

/** GET /api/admin/invites 列表项，含契约要求的 {@code used} / {@code expired} 计算字段。 */
public record InviteResponse(
        String code,
        long createdBy,
        String createdAt,
        String expiresAt,
        boolean used,
        boolean expired,
        Long usedBy,
        String usedAt) {

    public static InviteResponse of(Invite invite) {
        return new InviteResponse(
                invite.code(),
                invite.createdBy(),
                invite.createdAt(),
                invite.expiresAt(),
                invite.usedBy() != null,
                isExpired(invite.expiresAt()),
                invite.usedBy(),
                invite.usedAt());
    }

    static boolean isExpired(String expiresAt) {
        if (expiresAt == null) {
            return false;
        }
        try {
            return Instant.parse(expiresAt).isBefore(Instant.now());
        } catch (RuntimeException e) {
            return true;
        }
    }
}

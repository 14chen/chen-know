package com.kb.user;

/** {@code invites} 表一行。 */
public record Invite(
        String code,
        long createdBy,
        String createdAt,
        String expiresAt,
        Long usedBy,
        String usedAt) {
}

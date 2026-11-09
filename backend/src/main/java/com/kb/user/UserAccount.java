package com.kb.user;

/** {@code users} 表一行。角色只有 {@code admin} / {@code member}（SCHEMA §1）。 */
public record UserAccount(
        long id,
        String username,
        String displayName,
        String passwordHash,
        String role,
        boolean disabled,
        String createdAt) {

    public static final String ROLE_ADMIN = "admin";
    public static final String ROLE_MEMBER = "member";

    public boolean isAdmin() {
        return ROLE_ADMIN.equals(role);
    }
}

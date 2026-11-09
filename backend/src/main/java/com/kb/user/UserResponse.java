package com.kb.user;

/** API.md §1 的认证响应体：{@code {id, username, displayName, role}}。 */
public record UserResponse(long id, String username, String displayName, String role) {

    public static UserResponse of(UserAccount user) {
        return new UserResponse(user.id(), user.username(), user.displayName(), user.role());
    }

    public static UserResponse of(KbPrincipal principal) {
        return new UserResponse(principal.id(), principal.username(), principal.displayName(), principal.role());
    }
}

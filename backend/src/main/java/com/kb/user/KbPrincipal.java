package com.kb.user;

import java.security.Principal;
import java.util.List;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

/**
 * 会话中的登录主体。{@code spaceId} 是后续所有业务 SQL 的隔离依据（SCHEMA §0 多租户）。
 */
public record KbPrincipal(long id, String username, String displayName, String role, long spaceId)
        implements Principal {

    public boolean isAdmin() {
        return UserAccount.ROLE_ADMIN.equals(role);
    }

    /** 供 Spring Security 的 {@code hasRole("ADMIN")} 使用。 */
    public List<GrantedAuthority> authorities() {
        return List.of(new SimpleGrantedAuthority(isAdmin() ? "ROLE_ADMIN" : "ROLE_MEMBER"));
    }

    @Override
    public String getName() {
        return username;
    }
}

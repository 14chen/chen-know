package com.kb.user;

import com.kb.common.ErrorCode;
import com.kb.common.ErrorResponses;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 每个已认证请求都回查一次账号状态：
 * 账号被删除/停用 → 立刻 401；显示名、角色等变化 → 立刻生效，无需重新登录。
 */
@Component
public class AccountFreshnessFilter extends OncePerRequestFilter {

    private final UserRepository users;
    private final SpaceRepository spaces;
    private final SessionAuthenticator sessionAuthenticator;
    private final ErrorResponses errorResponses;

    public AccountFreshnessFilter(UserRepository users, SpaceRepository spaces,
            SessionAuthenticator sessionAuthenticator, ErrorResponses errorResponses) {
        this.users = users;
        this.spaces = spaces;
        this.sessionAuthenticator = sessionAuthenticator;
        this.errorResponses = errorResponses;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof KbPrincipal current)) {
            filterChain.doFilter(request, response);
            return;
        }
        UserAccount account = users.findById(current.id()).orElse(null);
        if (account == null || account.disabled()) {
            sessionAuthenticator.clearAuthentication(request);
            errorResponses.write(response, ErrorCode.UNAUTHORIZED,
                    account == null ? "账号不存在" : "账号已被停用");
            return;
        }
        long spaceId = spaces.findIdByOwner(account.id()).orElse(current.spaceId());
        if (spaceId != current.spaceId()
                || !account.role().equals(current.role())
                || !account.username().equals(current.username())
                || !account.displayName().equals(current.displayName())) {
            sessionAuthenticator.establish(
                    new KbPrincipal(account.id(), account.username(), account.displayName(), account.role(), spaceId),
                    request, response);
        }
        filterChain.doFilter(request, response);
    }

    /** 只对 API 请求生效；静态资源不必回查账号。 */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }
}

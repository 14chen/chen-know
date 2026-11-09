package com.kb.user;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Component;

/**
 * 登录态的建立与清除。
 *
 * <p>Spring Security 7 默认「显式保存」：手工认证后必须自己把 SecurityContext 写进仓库，
 * 否则下一个请求读不到。仓库统一用 {@link HttpSessionSecurityContextRepository}
 * （会话 Cookie 名与属性由 application.properties 配置为 KB_SESSION / HttpOnly / SameSite=Lax）。
 */
@Component
public class SessionAuthenticator {

    private final SecurityContextRepository securityContextRepository;

    public SessionAuthenticator(SecurityContextRepository securityContextRepository) {
        this.securityContextRepository = securityContextRepository;
    }

    public void establish(KbPrincipal principal, HttpServletRequest request, HttpServletResponse response) {
        Authentication authentication =
                new UsernamePasswordAuthenticationToken(principal, null, principal.authorities());
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        securityContextRepository.saveContext(context, request, response);
    }

    /** 会话失效但保留会话本身：用于账号被停用/删除后立刻失去访问权。 */
    public void clearAuthentication(HttpServletRequest request) {
        SecurityContextHolder.clearContext();
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.removeAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
        }
    }

    /** 登出：直接销毁会话。 */
    public void invalidateSession(HttpServletRequest request) {
        SecurityContextHolder.clearContext();
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
    }
}

package com.kb.config;

import com.kb.common.ErrorCode;
import com.kb.common.ErrorResponses;
import com.kb.user.AccountFreshnessFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.context.SecurityContextHolderFilter;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /** API.md §1：BCrypt 强度 10。 */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(10);
    }

    @Bean
    public SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
            SecurityContextRepository securityContextRepository,
            ErrorResponses errorResponses,
            AccountFreshnessFilter accountFreshnessFilter) throws Exception {
        // 故意不注册成 Spring Bean：否则 Boot 会把它另外注册成普通 Servlet 过滤器而重复执行
        RequestBodySizeLimitFilter bodySizeLimitFilter = new RequestBodySizeLimitFilter(errorResponses);
        OriginGuardFilter originGuardFilter = new OriginGuardFilter(errorResponses);
        http
                // 会话 Cookie 走 SameSite=Lax，跨站 POST 由浏览器拦截；CSRF token 不在 API.md 契约内
                .csrf(AbstractHttpConfigurer::disable)
                .securityContext(context -> context.securityContextRepository(securityContextRepository))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/api/health", "/api/auth/register", "/api/auth/login").permitAll()
                        .requestMatchers("/api/admin/**").hasRole("ADMIN")
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().permitAll())
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint((request, response, exception) ->
                                errorResponses.write(response, ErrorCode.UNAUTHORIZED, "未登录或会话已过期"))
                        .accessDeniedHandler((request, response, exception) ->
                                errorResponses.write(response, ErrorCode.FORBIDDEN, "无权访问该资源")))
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                // 安全响应头（DEF-E2-002）：CSP 的 script-src 由 CspDirectives 现算内联脚本哈希；
                // 其余安全头（nosniff / X-Frame-Options: DENY / Cache-Control）沿用 Spring Security 默认值
                .headers(headers -> headers
                        .contentSecurityPolicy(csp -> csp.policyDirectives(CspDirectives.contentSecurityPolicy()))
                        .referrerPolicy(referrer -> referrer
                                .policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN)))
                // 请求体上限放在最前面：未登录的巨型请求也要在鉴权之前被挡掉；
                // 其后再做跨源写请求校验（DEF-E2-004），最后才进认证与业务
                .addFilterBefore(originGuardFilter, SecurityContextHolderFilter.class)
                .addFilterBefore(bodySizeLimitFilter, OriginGuardFilter.class)
                .addFilterAfter(accountFreshnessFilter, SecurityContextHolderFilter.class);
        return http.build();
    }
}

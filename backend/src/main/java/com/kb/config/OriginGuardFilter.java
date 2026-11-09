package com.kb.config;

import com.kb.common.ErrorCode;
import com.kb.common.ErrorResponses;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.util.Locale;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 跨源写请求拦截（DEF-E2-004）。
 *
 * <p>背景：本项目的 CSRF 防线是会话 Cookie 的 {@code SameSite=Lax}（API.md §0.2 已声明不引入
 * CSRF token）。Lax 能挡住"跨站发起写请求时携带 Cookie"，但它只是浏览器一侧的行为：一旦某些
 * 客户端/旧浏览器不遵守，服务端没有任何第二道校验。这里补一道代价极低的服务端校验。
 *
 * <p>规则（只对非 GET/HEAD/OPTIONS/TRACE 生效）：
 * <ol>
 *   <li>带 {@code Origin}：必须与请求的 Host 同源，否则 403；</li>
 *   <li>不带 {@code Origin}：若 {@code Sec-Fetch-Site: cross-site} 则 403；</li>
 *   <li>两者都没有：放行 —— 命令行工具、curl、Node 的 fetch、既有自动化测试都不发 Origin，
 *       不能因为补一道 CSRF 防线就把它们全打死。</li>
 * </ol>
 *
 * <p>只比主机名（+ 显式端口），不比协议：本服务常在 Cloudflare 隧道/反向代理后，容器看到的
 * 是 http 而浏览器发的是 https，比协议会把正常请求误杀。
 */
public class OriginGuardFilter extends OncePerRequestFilter {

    /** 对外文案；与 403 语义一致（API.md §0.2）。 */
    static final String REJECT_MESSAGE = "跨源请求被拒绝";

    private final ErrorResponses errorResponses;

    public OriginGuardFilter(ErrorResponses errorResponses) {
        this.errorResponses = errorResponses;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        if (!requiresGuard(request.getMethod())) {
            filterChain.doFilter(request, response);
            return;
        }
        String origin = trimToNull(request.getHeader("Origin"));
        if (origin != null) {
            if (!sameOrigin(origin, request)) {
                errorResponses.write(response, ErrorCode.FORBIDDEN, REJECT_MESSAGE);
                return;
            }
        } else {
            String site = trimToNull(request.getHeader("Sec-Fetch-Site"));
            if (site != null && "cross-site".equals(site.toLowerCase(Locale.ROOT))) {
                errorResponses.write(response, ErrorCode.FORBIDDEN, REJECT_MESSAGE);
                return;
            }
        }
        filterChain.doFilter(request, response);
    }

    /** 只有会改数据的动作才校验；读请求保持现状（导出等 GET 的写日志已在契约中说明）。 */
    static boolean requiresGuard(String method) {
        if (method == null) {
            return false;
        }
        String m = method.toUpperCase(Locale.ROOT);
        return !("GET".equals(m) || "HEAD".equals(m) || "OPTIONS".equals(m) || "TRACE".equals(m));
    }

    static boolean sameOrigin(String origin, HttpServletRequest request) {
        if ("null".equalsIgnoreCase(origin)) {
            // 沙箱 iframe / file:// 发来的 Origin 字面量就是 null，一律不放行
            return false;
        }
        URI uri;
        try {
            uri = URI.create(origin);
        } catch (IllegalArgumentException e) {
            return false;
        }
        String originHost = uri.getHost();
        if (originHost == null) {
            return false;
        }
        String hostHeader = trimToNull(request.getHeader("Host"));
        String requestHost = hostHeader != null ? stripPort(hostHeader) : trimToNull(request.getServerName());
        if (requestHost == null || !originHost.equalsIgnoreCase(requestHost)) {
            return false;
        }
        int originPort = uri.getPort();
        if (originPort == -1) {
            // 浏览器对默认端口不写端口号（https 无端口、http 无端口都属这一类）
            return true;
        }
        int requestPort = hostPort(hostHeader, request);
        return requestPort <= 0 || originPort == requestPort;
    }

    private static int hostPort(String hostHeader, HttpServletRequest request) {
        if (hostHeader != null) {
            int idx = hostHeader.lastIndexOf(':');
            if (idx > 0 && idx < hostHeader.length() - 1) {
                String tail = hostHeader.substring(idx + 1);
                if (tail.chars().allMatch(Character::isDigit)) {
                    return Integer.parseInt(tail);
                }
            }
            return -1;
        }
        return request.getServerPort();
    }

    private static String stripPort(String host) {
        int idx = host.lastIndexOf(':');
        return idx > 0 ? host.substring(0, idx) : host;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String t = value.trim();
        return t.isEmpty() ? null : t;
    }
}

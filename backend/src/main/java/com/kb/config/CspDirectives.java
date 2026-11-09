package com.kb.config;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;

/**
 * 构造 Content-Security-Policy（API.md §0 安全头 / DEF-E2-002）。
 *
 * <p>为什么 script-src 需要哈希：前端 index.html 里有一段**内联**主题引导脚本
 * （在任何样式生效前设置 data-theme，避免刷新时白/黑闪一下）。如果只写
 * {@code script-src 'self'}，这段内联脚本会被浏览器拦掉 —— 页面不白屏，但主题引导失效并产生
 * securitypolicyviolation。既不能为此放开 {@code 'unsafe-inline'}（等于放弃 XSS 兜底），
 * 也不该手写死哈希（前端一改就过期），所以**启动时从 static/index.html 现算**。
 *
 * <p>算不出来（文件缺失/读失败）就退化为 {@code 'self'}，只是内联引导被拦，页面仍可用。
 */
public final class CspDirectives {

    private static final Logger log = LoggerFactory.getLogger(CspDirectives.class);

    /** 前端构建产物（jar 内 classpath 路径）。 */
    private static final String INDEX_HTML = "static/index.html";

    /** 只匹配**没有 src 属性**的脚本块。 */
    private static final Pattern INLINE_SCRIPT = Pattern.compile(
            "<script(?![^>]*\\bsrc\\s*=)[^>]*>(.*?)</script>",
            Pattern.DOTALL | Pattern.CASE_INSENSITIVE);

    private CspDirectives() {
    }

    /** 生成完整策略串（每条指令之间的分号由这里统一控制）。 */
    public static String contentSecurityPolicy() {
        String scriptSrc = "script-src 'self'" + hashSources();
        String policy = "default-src 'self'; "
                + scriptSrc + "; "
                // CodeMirror 6 用 StyleModule 动态注入 <style>，React 也有内联 style —— 这一条必须放开
                + "style-src 'self' 'unsafe-inline'; "
                + "img-src 'self' data: blob:; "
                + "font-src 'self' data:; "
                + "media-src 'self' blob:; "
                + "connect-src 'self'; "
                + "manifest-src 'self'; "
                + "worker-src 'self' blob:; "
                + "object-src 'none'; "
                + "frame-ancestors 'none'; "
                + "base-uri 'self'; "
                + "form-action 'self'";
        return policy;
    }

    /** 内联脚本的 sha256 列表（形如 {@code  'sha256-xxx' 'sha256-yyy'}）；没有则返回空串。 */
    static String hashSources() {
        List<String> hashes = inlineScriptHashes(INDEX_HTML);
        if (hashes.isEmpty()) {
            log.info("CSP: static/index.html 未发现内联脚本，script-src 仅 'self'");
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (String h : hashes) {
            sb.append(" 'sha256-").append(h).append('\'');
        }
        log.info("CSP: 允许 {} 段内联脚本（sha256: {}）", hashes.size(), String.join(", ", hashes));
        return sb.toString();
    }

    static List<String> inlineScriptHashes(String classpathLocation) {
        List<String> out = new ArrayList<>();
        ClassPathResource resource = new ClassPathResource(classpathLocation);
        if (!resource.exists()) {
            return out;
        }
        try (InputStream in = resource.getInputStream()) {
            String html = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            Matcher m = INLINE_SCRIPT.matcher(html);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            while (m.find()) {
                String body = m.group(1);
                if (body == null || body.isBlank()) {
                    continue;
                }
                byte[] hash = digest.digest(body.getBytes(StandardCharsets.UTF_8));
                digest.reset();
                out.add(Base64.getEncoder().encodeToString(hash));
            }
        } catch (IOException | java.security.NoSuchAlgorithmException e) {
            log.warn("CSP: 读取 {} 失败（{}），本次不添加内联脚本哈希", classpathLocation, e.getMessage());
        }
        return out;
    }
}

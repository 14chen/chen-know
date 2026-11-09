package com.kb.briefing;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * BRIEFING.md §3：跨天去重用的 URL 规范化 —— 去 fragment、去 utm_* / fbclid / ref 等跟踪参数。
 */
public final class BriefingUrls {

    private BriefingUrls() {
    }

    /**
     * SSRF 防护：只允许「公网 http/https」。拒绝回环、内网段、链路本地、组播、单段主机名、IPv6 字面量。
     *
     * <p>抓文章页 / 下载图片前必须过这一关，否则恶意文章链接可以让服务器访问 127.0.0.1 / 169.254 / 10.x。
     */
    public static boolean isPublicHttpUrl(String url) {
        if (!isHttpUrl(url)) {
            return false;
        }
        URI uri;
        try {
            uri = URI.create(url.trim());
        } catch (IllegalArgumentException e) {
            return false;
        }
        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            return false;
        }
        String name = host.toLowerCase(Locale.ROOT);
        if (name.startsWith("[") || name.contains(":")) {
            return false;                       // IPv6 字面量一律拒绝
        }
        if ("localhost".equals(name) || name.endsWith(".localhost") || "0.0.0.0".equals(name)) {
            return false;
        }
        String[] parts = name.split("\\.");
        if (parts.length < 2) {
            return false;                       // 单段主机名（内网短名）
        }
        if (parts.length == 4 && isAllDigits(parts)) {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            if (a == 0 || a == 10 || a == 127 || a >= 224) {
                return false;
            }
            if (a == 169 && b == 254) {
                return false;                   // 链路本地（云元数据）
            }
            if (a == 172 && b >= 16 && b <= 31) {
                return false;
            }
            if (a == 192 && b == 168) {
                return false;
            }
            if (a == 100 && b >= 64 && b <= 127) {
                return false;                   // CGNAT
            }
        }
        return true;
    }

    private static boolean isAllDigits(String[] parts) {
        for (String part : parts) {
            if (part.isEmpty() || part.length() > 3) {
                return false;
            }
            for (int index = 0; index < part.length(); index++) {
                if (!Character.isDigit(part.charAt(index))) {
                    return false;
                }
            }
        }
        return true;
    }

    public static boolean isHttpUrl(String url) {
        if (url == null) {
            return false;
        }
        String lower = url.trim().toLowerCase(Locale.ROOT);
        return lower.startsWith("http://") || lower.startsWith("https://");
    }

    /** 规范化；无法解析时至少去掉 fragment，保证同一链接不会因锚点被重复收录。 */
    public static String normalize(String raw) {
        String url = raw == null ? "" : raw.trim();
        if (url.isEmpty()) {
            return "";
        }
        try {
            URI uri = URI.create(url);
            if (uri.getScheme() == null || uri.getHost() == null) {
                return stripFragment(url);
            }
            String query = stripTracking(uri.getRawQuery());
            StringBuilder built = new StringBuilder();
            built.append(uri.getScheme()).append("://").append(uri.getRawAuthority());
            if (uri.getRawPath() != null) {
                built.append(uri.getRawPath());
            }
            if (query != null && !query.isEmpty()) {
                built.append('?').append(query);
            }
            return built.toString();
        } catch (IllegalArgumentException e) {
            return stripFragment(url);
        }
    }

    private static String stripFragment(String url) {
        int hash = url.indexOf('#');
        return hash < 0 ? url : url.substring(0, hash);
    }

    static String stripTracking(String rawQuery) {
        if (rawQuery == null || rawQuery.isEmpty()) {
            return null;
        }
        List<String> kept = new ArrayList<>();
        for (String param : rawQuery.split("&")) {
            if (param.isEmpty() || isTracking(param)) {
                continue;
            }
            kept.add(param);
        }
        return kept.isEmpty() ? null : String.join("&", kept);
    }

    static boolean isTracking(String param) {
        int equals = param.indexOf('=');
        String name = (equals < 0 ? param : param.substring(0, equals)).toLowerCase(Locale.ROOT);
        return name.startsWith("utm_")
                || name.startsWith("ref_")
                || name.equals("fbclid")
                || name.equals("gclid")
                || name.equals("igshid")
                || name.equals("mc_cid")
                || name.equals("mc_eid")
                || name.equals("spm")
                || name.equals("ref");
    }
}

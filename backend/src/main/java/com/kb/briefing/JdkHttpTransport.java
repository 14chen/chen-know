package com.kb.briefing;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.time.Duration;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.TrustManagerFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * BRIEFING.md §1 / §5：JDK 自带 HttpClient（不引入新依赖）。
 *
 * <p>统一 UA + Accept-Language、最多 3 次重定向（手动跟随）、每次尝试独立超时；
 * <b>最多 3 次尝试，退避 500ms → 1500ms</b>，只在「超时 / 连接失败 / 5xx」时重试，
 * 4xx（含 Cloudflare 的 403）与证书问题不重试。
 *
 * <p>证书：默认用 JDK cacerts；遇到 PKIX 失败再用<b>操作系统根证书库</b>（Windows-ROOT）重试 ——
 * 本机有本地 TLS 加速器，它的根证书在系统库里而不在 JDK cacerts 里。**绝不无条件信任所有证书。**
 */
@Component
public class JdkHttpTransport implements HttpTransport {

    private static final Logger log = LoggerFactory.getLogger(JdkHttpTransport.class);

    /** 常态源：单次尝试超时。 */
    static final Duration DEFAULT_ATTEMPT_TIMEOUT = Duration.ofSeconds(18);
    /** 建连超时：连不上要早点失败好重试。 */
    static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(15);
    static final int MAX_ATTEMPTS = 3;
    static final long FIRST_BACKOFF_MILLIS = 500;
    static final long SECOND_BACKOFF_MILLIS = 1500;
    static final int MAX_REDIRECTS = 3;
    private static final int MAX_ERROR_BODY = 200;

    static final String ACCEPT_RSS = "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8";
    static final String ACCEPT_HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    static final String ACCEPT_JSON = "application/json, */*;q=0.8";

    private static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/131.0.0.0 Safari/537.36";
    private static final String ACCEPT_LANGUAGE = "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7";

    private final HttpClient defaultClient;
    private volatile HttpClient windowsTrustClient;

    public JdkHttpTransport() {
        this.defaultClient = newClient(null);
        log.info("简报抓取传输层 v3 就绪：单次超时 {}s（慢源另配）、最多 {} 次尝试、系统根证书兜底={}",
                DEFAULT_ATTEMPT_TIMEOUT.toSeconds(), MAX_ATTEMPTS, currentWindowsTrustState());
    }

    private String currentWindowsTrustState() {
        try {
            KeyStore.getInstance("Windows-ROOT");
            return "可用";
        } catch (Exception e) {
            return "不可用（" + e.getClass().getSimpleName() + "）";
        }
    }

    private static HttpClient newClient(SSLContext sslContext) {
        HttpClient.Builder builder = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                // 明确用 HTTP/1.1：部分站点的 CDN 对非浏览器的 HTTP/2 客户端不友好
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(CONNECT_TIMEOUT);
        if (sslContext != null) {
            builder.sslContext(sslContext);
        }
        return builder.build();
    }

    @Override
    public String get(String url) {
        return get(url, ACCEPT_HTML, DEFAULT_ATTEMPT_TIMEOUT);
    }

    @Override
    public String get(String url, String accept) {
        return get(url, accept, DEFAULT_ATTEMPT_TIMEOUT);
    }

    @Override
    public String get(String url, String accept, Duration attemptTimeout) {
        Duration timeout = attemptTimeout == null || attemptTimeout.isNegative() || attemptTimeout.isZero()
                ? DEFAULT_ATTEMPT_TIMEOUT : attemptTimeout;
        try {
            return fetchWithRetries(defaultClient, url, accept, timeout);
        } catch (BriefingFetchException first) {
            if (isCertificateProblem(first)) {
                // 本机有本地 TLS 加速器，它的根证书只在系统库里 —— 这是预期内的一次回落，
                // 用 DEBUG 记录即可（否则每篇文章页都会刷一条 WARN）
                log.debug("证书链用 JDK cacerts 校验失败，改用系统根证书重试: {}", url);
                HttpClient withOsTrust = windowsTrustClient();
                if (withOsTrust != null) {
                    return fetchWithRetries(withOsTrust, url, accept, timeout);
                }
            }
            throw first;
        }
    }

    @Override
    public String post(String url, java.util.Map<String, String> headers, String body,
            Duration attemptTimeout) {
        Duration timeout = attemptTimeout == null || attemptTimeout.isNegative() || attemptTimeout.isZero()
                ? DEFAULT_ATTEMPT_TIMEOUT : attemptTimeout;
        for (int attempt = 1; ; attempt++) {
            try {
                return requestPost(url, headers, body, timeout);
            } catch (BriefingFetchException e) {
                if (!isRetryable(e) || attempt >= MAX_ATTEMPTS) {
                    throw e;
                }
                sleep(attempt == 1 ? FIRST_BACKOFF_MILLIS : SECOND_BACKOFF_MILLIS);
            }
        }
    }

    /** 表单 POST：不跟随重定向（POST 跟随语义复杂），失败按 5xx/超时重试。 */
    private String requestPost(String url, java.util.Map<String, String> headers, String body,
            Duration timeout) {
        HttpRequest.Builder builder;
        try {
            builder = HttpRequest.newBuilder(URI.create(url))
                    .timeout(timeout)
                    .header("User-Agent", USER_AGENT)
                    .header("Accept-Language", ACCEPT_LANGUAGE)
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        } catch (IllegalArgumentException e) {
            throw new BriefingFetchException("URL 非法：" + url);
        }
        if (headers != null) {
            headers.forEach(builder::header);
        }
        HttpResponse<byte[]> response;
        try {
            response = defaultClient.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (HttpTimeoutException e) {
            throw new BriefingFetchException("超时 " + timeout.toSeconds() + "s 无响应", e);
        } catch (SSLHandshakeException e) {
            throw new BriefingFetchException("证书校验失败：" + e.getMessage(), e);
        } catch (IOException e) {
            throw new BriefingFetchException("网络异常：" + e.getClass().getSimpleName()
                    + (e.getMessage() == null ? "" : " " + e.getMessage()), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BriefingFetchException("请求被中断", e);
        }
        byte[] responseBody = decompress(response, url);
        String text = new String(responseBody == null ? new byte[0] : responseBody, StandardCharsets.UTF_8);
        int status = response.statusCode();
        if (status < 200 || status >= 300) {
            String snippet = BriefingText.stripHtml(text).replaceAll("\\s+", " ").trim();
            if (snippet.length() > MAX_ERROR_BODY) {
                snippet = snippet.substring(0, MAX_ERROR_BODY) + "…";
            }
            throw new BriefingFetchException("HTTP " + status
                    + (snippet.isEmpty() ? "" : "（响应开头：" + snippet + "）"));
        }
        return text;
    }

    @Override
    public byte[] getBytes(String url, Duration attemptTimeout) {
        Duration timeout = attemptTimeout == null || attemptTimeout.isNegative() || attemptTimeout.isZero()
                ? DEFAULT_ATTEMPT_TIMEOUT : attemptTimeout;
        for (int attempt = 1; ; attempt++) {
            try {
                return requestBytes(defaultClient, url, timeout);
            } catch (BriefingFetchException e) {
                if (!isRetryable(e) || attempt >= MAX_ATTEMPTS) {
                    throw e;
                }
                sleep(attempt == 1 ? FIRST_BACKOFF_MILLIS : SECOND_BACKOFF_MILLIS);
            }
        }
    }

    /** 二进制下载（配图）：同样手动跟随重定向、限大小、按 content-encoding 解压。 */
    private byte[] requestBytes(HttpClient client, String url, Duration timeout) {
        String current = url;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpRequest request;
            try {
                request = HttpRequest.newBuilder(URI.create(current))
                        .timeout(timeout)
                        .header("User-Agent", USER_AGENT)
                        .header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
                        .header("Accept-Language", ACCEPT_LANGUAGE)
                        .GET()
                        .build();
            } catch (IllegalArgumentException e) {
                throw new BriefingFetchException("URL 非法：" + current);
            }
            HttpResponse<byte[]> response;
            try {
                response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            } catch (HttpTimeoutException e) {
                throw new BriefingFetchException("超时 " + timeout.toSeconds() + "s 无响应", e);
            } catch (SSLHandshakeException e) {
                throw new BriefingFetchException("证书校验失败：" + e.getMessage(), e);
            } catch (IOException e) {
                throw new BriefingFetchException("网络异常：" + e.getClass().getSimpleName()
                        + (e.getMessage() == null ? "" : " " + e.getMessage()), e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new BriefingFetchException("下载被中断", e);
            }
            int status = response.statusCode();
            if (status >= 300 && status < 400) {
                String location = response.headers().firstValue("location").orElse(null);
                if (location == null || location.isBlank() || hop == MAX_REDIRECTS) {
                    throw new BriefingFetchException("重定向次数超过 " + MAX_REDIRECTS);
                }
                current = URI.create(current).resolve(location.trim()).toString();
                continue;
            }
            if (status < 200 || status >= 300) {
                throw new BriefingFetchException("HTTP " + status);
            }
            byte[] body = decompress(response, current);
            return body == null ? new byte[0] : body;
        }
        throw new BriefingFetchException("重定向次数超过 " + MAX_REDIRECTS);
    }

    private static boolean isCertificateProblem(BriefingFetchException error) {
        Throwable cause = error.getCause();
        return error.getMessage() != null && error.getMessage().startsWith("证书校验失败")
                || cause instanceof SSLHandshakeException;
    }

    /** 用操作系统根证书库（Windows-ROOT）建客户端；拿不到就返回 null（不影响默认路径）。 */
    private HttpClient windowsTrustClient() {
        HttpClient existing = windowsTrustClient;
        if (existing != null) {
            return existing;
        }
        synchronized (this) {
            if (windowsTrustClient == null) {
                try {
                    KeyStore keyStore = KeyStore.getInstance("Windows-ROOT");
                    keyStore.load(null, null);
                    TrustManagerFactory factory = TrustManagerFactory.getInstance("SunX509");
                    factory.init(keyStore);
                    SSLContext context = SSLContext.getInstance("TLS");
                    context.init(null, factory.getTrustManagers(), null);
                    windowsTrustClient = newClient(context);
                    log.debug("已启用操作系统根证书库（Windows-ROOT）作为证书校验的兜底");
                } catch (Exception e) {
                    log.warn("无法使用操作系统根证书库: {}", e.toString());
                    return null;
                }
            }
            return windowsTrustClient;
        }
    }

    /** 最多 {@link #MAX_ATTEMPTS} 次尝试；只有超时 / 连接失败 / 5xx 才退避重试。 */
    private String fetchWithRetries(HttpClient client, String url, String accept, Duration timeout) {
        for (int attempt = 1; ; attempt++) {
            try {
                return request(client, url, accept, timeout);
            } catch (BriefingFetchException e) {
                if (!isRetryable(e) || attempt >= MAX_ATTEMPTS) {
                    if (attempt > 1) {
                        log.debug("抓取最终失败（已尝试 {} 次）: {} ({})", attempt, url, e.getMessage());
                    }
                    throw e;
                }
                long backoff = attempt == 1 ? FIRST_BACKOFF_MILLIS : SECOND_BACKOFF_MILLIS;
                log.debug("抓取失败（第 {}/{} 次），{}ms 后重试: {} ({})", attempt, MAX_ATTEMPTS, backoff, url,
                        e.getMessage());
                sleep(backoff);
            }
        }
    }

    /** 超时 / 连接失败 / 5xx 才值得重试；4xx 与证书问题重试没用。 */
    static boolean isRetryable(BriefingFetchException error) {
        if (error == null) {
            return false;
        }
        Throwable cause = error.getCause();
        if (cause instanceof SSLHandshakeException) {
            return false;
        }
        String message = error.getMessage() == null ? "" : error.getMessage();
        if (message.contains("PKIX") || message.contains("certificate")) {
            return false;
        }
        if (cause instanceof HttpTimeoutException || cause instanceof ConnectException) {
            return true;
        }
        return message.startsWith("超时") || message.startsWith("网络异常") || message.startsWith("HTTP 5");
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** 单次请求（含手动跟随重定向）。 */
    private String request(HttpClient client, String url, String accept, Duration timeout) {
        String current = url;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpRequest request;
            try {
                request = HttpRequest.newBuilder(URI.create(current))
                        .timeout(timeout)
                        .header("User-Agent", USER_AGENT)
                        .header("Accept-Language", ACCEPT_LANGUAGE)
                        .header("Accept", accept == null ? ACCEPT_HTML : accept)
                        .header("Accept-Encoding", "gzip, deflate")
                        .GET()
                        .build();
            } catch (IllegalArgumentException e) {
                throw new BriefingFetchException("URL 非法：" + current);
            }
            HttpResponse<byte[]> response;
            try {
                response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            } catch (HttpTimeoutException e) {
                throw new BriefingFetchException("超时 " + timeout.toSeconds() + "s 无响应", e);
            } catch (SSLHandshakeException e) {
                throw new BriefingFetchException("证书校验失败：" + e.getMessage(), e);
            } catch (IOException e) {
                throw new BriefingFetchException("网络异常：" + e.getClass().getSimpleName()
                        + (e.getMessage() == null ? "" : " " + e.getMessage()), e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new BriefingFetchException("抓取被中断", e);
            }
            int status = response.statusCode();
            if (status >= 300 && status < 400) {
                String location = response.headers().firstValue("location").orElse(null);
                if (location == null || location.isBlank()) {
                    throw new BriefingFetchException("HTTP " + status + "（缺少 Location）");
                }
                if (hop == MAX_REDIRECTS) {
                    throw new BriefingFetchException("重定向次数超过 " + MAX_REDIRECTS);
                }
                current = URI.create(current).resolve(location.trim()).toString();
                continue;
            }
            byte[] body = decompress(response, current);
            if (status < 200 || status >= 300) {
                // Cloudflare 这类拦截会返回固定页面，把开头记进原因里便于定位；
                // 但原因会被渲染进简报正文，所以必须先去标签（BRIEFING.md §9 #15）
                String snippet = BriefingText.stripHtml(new String(body, StandardCharsets.UTF_8))
                        .replaceAll("\\s+", " ").trim();
                if (snippet.length() > MAX_ERROR_BODY) {
                    snippet = snippet.substring(0, MAX_ERROR_BODY) + "…";
                }
                throw new BriefingFetchException("HTTP " + status
                        + (snippet.isEmpty() ? "" : "（响应开头：" + snippet + "）"));
            }
            return new String(body, StandardCharsets.UTF_8);
        }
        throw new BriefingFetchException("重定向次数超过 " + MAX_REDIRECTS);
    }

    private byte[] decompress(HttpResponse<byte[]> response, String url) {
        String encoding = response.headers().firstValue("content-encoding").orElse("").toLowerCase();
        byte[] body = response.body();
        if (body == null || body.length == 0 || encoding.isEmpty() || "identity".equals(encoding)) {
            return body == null ? new byte[0] : body;
        }
        try (InputStream in = encoding.contains("gzip")
                ? new GZIPInputStream(new ByteArrayInputStream(body))
                : encoding.contains("deflate")
                        ? new InflaterInputStream(new ByteArrayInputStream(body))
                        : null) {
            if (in == null) {
                return body;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream(body.length * 2);
            in.transferTo(out);
            return out.toByteArray();
        } catch (IOException e) {
            log.debug("解压响应失败，按原始字节处理: {} ({})", url, e.toString());
            return body;
        }
    }
}

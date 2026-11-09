package com.kb.briefing;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * MyMemory 免费翻译端点（Google 的 gtx 端点在本机超时不可用）。
 *
 * <p>两个坑写在这里，别再踩：
 * <ul>
 *   <li><b>必须带 {@code de=} 联系邮箱</b>：不带时用的是「整台机器共享的匿名配额」，会被打光
 *       （实测返回 429 + {@code quotaFinished}），带上走私有配额就好用了</li>
 *   <li>配额耗尽时它<b>仍然返回 200 语义的 JSON</b>，但 {@code translatedText} 里塞的是
 *       「MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY」——
 *       必须识别出来当失败，否则这句话会被当成译文写进简报</li>
 * </ul>
 */
public class MyMemoryTranslationClient implements TranslationClient {

    private static final Logger log = LoggerFactory.getLogger(MyMemoryTranslationClient.class);

    static final String ENDPOINT = "https://api.mymemory.translated.net/get";
    static final int MAX_QUERY_CHARS = 400;
    /** 单次超时：翻译是锦上添花，4s 拿不到就放弃（transport 还会重试）。 */
    static final Duration ATTEMPT_TIMEOUT = Duration.ofSeconds(4);
    /** 并发上限：MyMemory 对并发敏感，6 路实测稳定。 */
    static final int MAX_CONCURRENCY = 8;
    /** 单次运行里连续失败这么多次就熔断，别再耗预算。 */
    static final int BREAKER_THRESHOLD = 3;
    /**
     * MyMemory 的 {@code de} 参数（联系邮箱）用于走私有配额。
     * 需要换成自己的邮箱时改这一行即可（不改配置，避免多一个键）。
     */
    static final String CONTACT_EMAIL = "kb-briefing@example.com";

    private final HttpTransport transport;
    private final Semaphore permits = new Semaphore(MAX_CONCURRENCY);
    private final AtomicInteger consecutiveFailures = new AtomicInteger();

    public MyMemoryTranslationClient(HttpTransport transport) {
        this.transport = transport;
    }

    @Override
    public String providerName() {
        return "mymemory";
    }

    @Override
    public String translate(String text) {
        String source = text == null ? "" : text.trim();
        if (source.isEmpty()) {
            return "";
        }
        if (consecutiveFailures.get() >= BREAKER_THRESHOLD) {
            throw new BriefingFetchException("翻译服务本轮已熔断（连续失败 " + BREAKER_THRESHOLD + " 次）");
        }
        String query = BriefingText.truncate(source, MAX_QUERY_CHARS);
        String url = ENDPOINT + "?q=" + URLEncoder.encode(query, StandardCharsets.UTF_8)
                + "&langpair=" + URLEncoder.encode("en|zh-CN", StandardCharsets.UTF_8)
                + "&de=" + URLEncoder.encode(CONTACT_EMAIL, StandardCharsets.UTF_8);
        String body = fetchWithPermit(url);
        String translated = parse(body, source);
        consecutiveFailures.set(0);
        return translated;
    }

    private String parse(String body, String source) {
        try {
            java.util.Map<String, Object> root = MiniJson.asObject(MiniJson.parse(body));
            java.util.Map<String, Object> data = MiniJson.asObject(root.get("responseData"));
            String translated = MiniJson.string(data.get("translatedText"));
            if (Boolean.TRUE.equals(root.get("quotaFinished"))) {
                throw new BriefingFetchException("翻译配额已用尽");
            }
            Integer status = MiniJson.integer(root.get("responseStatus"));
            if (status != null && status != 200) {
                throw new BriefingFetchException("翻译服务返回 " + status + "（多为配额/限流）");
            }
            if (translated == null || translated.isBlank()) {
                throw new BriefingFetchException("翻译没有返回结果");
            }
            String cleaned = BriefingText.stripHtml(translated).trim();
            if (looksLikeQuotaWarning(cleaned)) {
                throw new BriefingFetchException("翻译配额已用尽（服务端给出告警文本）");
            }
            if (cleaned.equalsIgnoreCase(source)) {
                throw new BriefingFetchException("翻译结果与原文相同");
            }
            return cleaned;
        } catch (IllegalArgumentException e) {
            throw new BriefingFetchException("翻译响应无法解析：" + e.getMessage());
        }
    }

    /** 配额耗尽时 MyMemory 把告警塞进 translatedText，绝不能当译文用。 */
    static boolean looksLikeQuotaWarning(String text) {
        if (text == null) {
            return false;
        }
        String upper = text.toUpperCase(Locale.ROOT);
        return upper.startsWith("MYMEMORY WARNING") || upper.contains("YOU USED ALL AVAILABLE FREE TRANSLATIONS")
                || upper.contains("QUOTA") || upper.contains("PLEASE SELECT TWO DISTINCT LANGUAGES");
    }

    /** 限并发 + 暂时性失败重试；彻底失败抛给调用方（调用方保留原文）。 */
    private String fetchWithPermit(String url) {
        RuntimeException last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            boolean acquired = false;
            try {
                permits.acquire();
                acquired = true;
                return transport.get(url, JdkHttpTransport.ACCEPT_JSON, ATTEMPT_TIMEOUT);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new BriefingFetchException("翻译被中断");
            } catch (RuntimeException e) {
                last = e instanceof BriefingFetchException failure
                        ? failure : new BriefingFetchException("翻译失败：" + e.getMessage());
                if (attempt < 3) {
                    try {
                        Thread.sleep(400L * attempt);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            } finally {
                if (acquired) {
                    permits.release();
                }
            }
        }
        consecutiveFailures.incrementAndGet();
        throw last == null ? new BriefingFetchException("翻译失败") : last;
    }
}

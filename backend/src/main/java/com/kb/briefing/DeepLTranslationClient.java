package com.kb.briefing;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * DeepL 翻译（免费 key 以 {@code :fx} 结尾，走 api-free 端点；付费 key 走 api）。
 *
 * <p>要点：
 * <ul>
 *   <li>鉴权走请求头 {@code Authorization: DeepL-Auth-Key <key>}，key 不出现在 URL 里（不落日志）</li>
 *   <li>{@code target_lang=ZH}（DeepL 用大写 ZH，不是 zh-CN）</li>
 *   <li>批量：一次 POST 多个 {@code text} 字段，上限 50 条 → 自动分片</li>
 *   <li>403 / 456 / 429 分别是「key 无效 / 额度用尽 / 限流」，分开记清楚</li>
 * </ul>
 */
public class DeepLTranslationClient implements TranslationClient {

    private static final Logger log = LoggerFactory.getLogger(DeepLTranslationClient.class);

    static final String ENDPOINT_FREE = "https://api-free.deepl.com/v2/translate";
    static final String ENDPOINT_PAID = "https://api.deepl.com/v2/translate";
    /** 免费版与付费版单次上限都是 50 条。 */
    static final int MAX_TEXTS_PER_REQUEST = 50;
    static final Duration ATTEMPT_TIMEOUT = Duration.ofSeconds(20);
    /** 连续失败这么多次就熔断。 */
    static final int BREAKER_THRESHOLD = 3;
    /** DeepL 单条文本长度上限（按字符）；先截断，避免整批 400。 */
    static final int MAX_TEXT_CHARS = 400;

    private final HttpTransport transport;
    private final String authKey;
    private final String endpoint;
    private final AtomicInteger consecutiveFailures = new AtomicInteger();

    public DeepLTranslationClient(HttpTransport transport, String authKey, String endpointOverride) {
        this.transport = transport;
        this.authKey = authKey == null ? "" : authKey.trim();
        this.endpoint = endpointOverride == null || endpointOverride.isBlank()
                ? defaultEndpoint(this.authKey) : endpointOverride.trim();
    }

    static boolean isFreeKey(String key) {
        return key != null && key.trim().toLowerCase(Locale.ROOT).endsWith(":fx");
    }

    static String defaultEndpoint(String key) {
        return isFreeKey(key) ? ENDPOINT_FREE : ENDPOINT_PAID;
    }

    String endpoint() {
        return endpoint;
    }

    boolean isFreeEndpoint() {
        return ENDPOINT_FREE.equals(endpoint);
    }

    @Override
    public String providerName() {
        return "deepl(" + (isFreeEndpoint() ? "free" : "pro") + ")";
    }

    @Override
    public String translate(String text) {
        List<String> single = translateAll(List.of(text == null ? "" : text));
        if (single.isEmpty() || single.get(0) == null) {
            throw new BriefingFetchException("DeepL 翻译失败");
        }
        return single.get(0);
    }

    @Override
    public List<String> translateAll(List<String> texts) {
        List<String> results = new ArrayList<>(texts.size());
        if (texts.isEmpty()) {
            return results;
        }
        if (authKey.isEmpty()) {
            throw new BriefingFetchException("DeepL key 未配置");
        }
        if (consecutiveFailures.get() >= BREAKER_THRESHOLD) {
            throw new BriefingFetchException("DeepL 本轮已熔断（连续失败 " + BREAKER_THRESHOLD + " 次）");
        }
        for (int start = 0; start < texts.size(); start += MAX_TEXTS_PER_REQUEST) {
            int end = Math.min(start + MAX_TEXTS_PER_REQUEST, texts.size());
            results.addAll(translateChunk(texts.subList(start, end)));
        }
        return results;
    }

    /** 一片最多 50 条；整片失败即抛（调用方保留原文）。 */
    private List<String> translateChunk(List<String> chunk) {
        StringBuilder body = new StringBuilder();
        for (String text : chunk) {
            String trimmed = BriefingText.truncate(text == null ? "" : text, MAX_TEXT_CHARS);
            if (body.length() > 0) {
                body.append('&');
            }
            body.append("text=").append(URLEncoder.encode(trimmed, StandardCharsets.UTF_8));
        }
        body.append("&target_lang=ZH");
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "DeepL-Auth-Key " + authKey);
        headers.put("Content-Type", "application/x-www-form-urlencoded; charset=utf-8");
        headers.put("Accept", "application/json");

        String response;
        try {
            response = transport.post(endpoint, headers, body.toString(), ATTEMPT_TIMEOUT);
            consecutiveFailures.set(0);
        } catch (RuntimeException e) {
            consecutiveFailures.incrementAndGet();
            throw classify(e);
        }
        return parse(response, chunk.size());
    }

    /** 把 HTTP 码翻译成人能看懂的失败原因（403 = key，456 = 额度，429 = 限流）。 */
    static String describeHttpError(String message) {
        if (message == null) {
            return "DeepL 调用失败";
        }
        if (message.contains("HTTP 403")) {
            return "DeepL 鉴权失败（key 无效或与端点不匹配）";
        }
        if (message.contains("HTTP 456")) {
            return "DeepL 额度已用尽（456）";
        }
        if (message.contains("HTTP 429")) {
            return "DeepL 限流（429），稍后重试";
        }
        if (message.contains("HTTP 4")) {
            return "DeepL 请求被拒绝：" + message;
        }
        return "DeepL 调用失败：" + message;
    }

    private BriefingFetchException classify(RuntimeException error) {
        String reason = describeHttpError(error.getMessage());
        log.warn("{} → 本次保留原文", reason);
        return new BriefingFetchException(reason, error);
    }

    private List<String> parse(String response, int expected) {
        List<String> out = new ArrayList<>(expected);
        try {
            Object translations = MiniJson.asObject(MiniJson.parse(response)).get("translations");
            for (Object element : MiniJson.asArray(translations)) {
                String text = MiniJson.string(MiniJson.asObject(element).get("text"));
                out.add(text == null || text.isBlank() ? null : BriefingText.stripHtml(text).trim());
            }
        } catch (IllegalArgumentException e) {
            throw new BriefingFetchException("DeepL 响应无法解析：" + e.getMessage());
        }
        if (out.size() != expected) {
            throw new BriefingFetchException("DeepL 返回条数与请求不一致（" + out.size() + "/" + expected + "）");
        }
        return out;
    }
}

package com.kb.briefing;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 从文章页 HTML 里抽「更充实的摘要」和「首图」，纯函数、可单测。
 *
 * <p>顺序：{@code og:description} → {@code meta[name=description]} → 首个足够长的 {@code <p>}；
 * 图片：{@code og:image} → {@code twitter:image} → 页面首个 {@code <img src>}，
 * 并过滤 logo / 二维码 / 头像 / 图标 / sprite / emoji / 1x1 这类装饰图。
 */
public final class ArticleExtractor {

    /** @param description 更充实的摘要（可能为 null） @param imageUrl 首图绝对地址（可能为 null） */
    public record Page(String description, String imageUrl) {

        static final Page EMPTY = new Page(null, null);
    }

    private static final Pattern META = Pattern.compile("<meta\\b[^>]*>", Pattern.CASE_INSENSITIVE);
    private static final Pattern IMG = Pattern.compile("<img\\b[^>]*>", Pattern.CASE_INSENSITIVE);
    private static final Pattern PARAGRAPH = Pattern.compile("<p\\b[^>]*>(.*?)</p>",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern ATTRIBUTE = Pattern.compile(
            "([a-zA-Z_:][-a-zA-Z0-9_:.]*)\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))");

    private static final String[] BAD_IMAGE_TOKENS = {
            "logo", "qrcode", "qr-code", "avatar", "icon", "sprite", "emoji", "gravatar",
            "favicon", "badge", "pixel", "tracking", "1x1", "spacer", "placeholder", "blank.",
            "100x100", "50x50", "32x32", "16x16"};

    private static final int MIN_DESCRIPTION_CHARS = 40;

    private ArticleExtractor() {
    }

    public static Page parse(String html, String baseUrl) {
        if (html == null || html.isBlank()) {
            return Page.EMPTY;
        }
        Map<String, String> meta = metas(html);
        String description = firstNonBlank(meta.get("og:description"), meta.get("twitter:description"),
                meta.get("description"));
        if (description == null) {
            description = firstParagraph(html);
        }
        String image = firstNonBlank(meta.get("og:image"), meta.get("og:image:url"),
                meta.get("twitter:image"), meta.get("twitter:image:src"), firstImage(html));
        if (image != null && isDecoration(image)) {
            image = null;
        }
        return new Page(description == null ? null : BriefingText.collapse(BriefingText.stripHtml(description)),
                image == null ? null : absolutize(image, baseUrl));
    }

    /** 装饰图/占位图判定（量子位的 og:image 是站点 logo，必须挡掉）。 */
    public static boolean isDecoration(String url) {
        if (url == null || url.isBlank()) {
            return true;
        }
        String lower = url.toLowerCase(Locale.ROOT);
        if (lower.startsWith("data:")) {
            return true;
        }
        for (String token : BAD_IMAGE_TOKENS) {
            if (lower.contains(token)) {
                return true;
            }
        }
        return false;
    }

    static String absolutize(String url, String baseUrl) {
        String trimmed = url.trim();
        try {
            URI base = URI.create(baseUrl == null ? "" : baseUrl);
            URI resolved = base.resolve(trimmed);
            return resolved.toString();
        } catch (IllegalArgumentException e) {
            return trimmed;
        }
    }

    private static Map<String, String> metas(String html) {
        Map<String, String> values = new LinkedHashMap<>();
        Matcher matcher = META.matcher(html);
        while (matcher.find()) {
            Map<String, String> attributes = attributes(matcher.group());
            String key = attributes.get("property");
            if (key == null) {
                key = attributes.get("name");
            }
            String content = attributes.get("content");
            if (key != null && content != null) {
                values.putIfAbsent(key.trim().toLowerCase(Locale.ROOT), content.trim());
            }
        }
        return values;
    }

    private static String firstImage(String html) {
        Matcher matcher = IMG.matcher(html);
        while (matcher.find()) {
            Map<String, String> attributes = attributes(matcher.group());
            String src = firstNonBlank(attributes.get("src"), attributes.get("data-src"),
                    attributes.get("data-original"));
            if (src != null && !isDecoration(src)) {
                return src;
            }
        }
        return null;
    }

    private static String firstParagraph(String html) {
        Matcher matcher = PARAGRAPH.matcher(html);
        while (matcher.find()) {
            String text = BriefingText.collapse(BriefingText.stripHtml(matcher.group(1)));
            if (text.length() >= MIN_DESCRIPTION_CHARS && !looksLikeChrome(text)) {
                return text;
            }
        }
        return null;
    }

    /** 过滤导航/版权/分享栏这类「不是内容」的段落。 */
    private static boolean looksLikeChrome(String text) {
        String lower = text.toLowerCase(Locale.ROOT);
        return lower.contains("cookie") || lower.contains("subscribe") || lower.contains("newsletter")
                || lower.contains("all rights reserved") || lower.contains("sign up")
                || lower.contains("privacy policy") || lower.contains("javascript");
    }

    private static Map<String, String> attributes(String tag) {
        Map<String, String> values = new LinkedHashMap<>();
        Matcher matcher = ATTRIBUTE.matcher(tag);
        while (matcher.find()) {
            String name = matcher.group(1).toLowerCase(Locale.ROOT);
            String value = matcher.group(3) != null ? matcher.group(3)
                    : matcher.group(4) != null ? matcher.group(4) : matcher.group(5);
            values.putIfAbsent(name, value == null ? "" : value);
        }
        return values;
    }

    private static String firstNonBlank(String... candidates) {
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate;
            }
        }
        return null;
    }
}

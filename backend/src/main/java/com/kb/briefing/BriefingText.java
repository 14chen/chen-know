package com.kb.briefing;

import java.util.Locale;

/**
 * BRIEFING.md §4：正文里的文本处理 —— 去 HTML 标签、折叠空白、截断 120 字，
 * 并保证「正文里不得出现未转义的 HTML 标签」。
 */
public final class BriefingText {

    /** 摘要截断长度（契约 §4）。 */
    public static final int SUMMARY_LIMIT = 120;

    private BriefingText() {
    }

    /** 去掉所有 HTML 标签；残余的 {@code <}/{@code >} 转成实体，避免被编辑器当成标签渲染。 */
    public static String stripHtml(String html) {
        if (html == null || html.isEmpty()) {
            return "";
        }
        String text = html
                .replaceAll("(?is)<script[^>]*>.*?</script>", " ")
                .replaceAll("(?is)<style[^>]*>.*?</style>", " ")
                .replaceAll("(?s)<!--.*?-->", " ")
                .replaceAll("(?s)<[^>]{0,2000}>", " ");
        text = decodeEntities(text);
        text = collapse(text);
        return text.replace("<", "&lt;").replace(">", "&gt;");
    }

    /** 摘要：去标签 + 折叠空白 + 截断到 {@value #SUMMARY_LIMIT} 字。 */
    public static String summary(String html) {
        return truncate(stripHtml(html), SUMMARY_LIMIT);
    }

    /** 标题：同样不允许残留标签，但不截断（标题本来就不长）。 */
    /**
     * 是否已经是中文：CJK 字符占「字母/数字」的比例 &gt; 30%。
     * 中文内容不再送翻译（省配额，也避免把中文翻坏）。
     */
    public static boolean looksChinese(String text) {
        if (text == null || text.isBlank()) {
            return false;
        }
        int meaningful = 0;
        int cjk = 0;
        for (int index = 0; index < text.length(); ) {
            int codePoint = text.codePointAt(index);
            index += Character.charCount(codePoint);
            if (!Character.isLetterOrDigit(codePoint)) {
                continue;
            }
            meaningful++;
            Character.UnicodeScript script = Character.UnicodeScript.of(codePoint);
            if (script == Character.UnicodeScript.HAN || script == Character.UnicodeScript.HIRAGANA
                    || script == Character.UnicodeScript.KATAKANA) {
                cjk++;
            }
        }
        return meaningful > 0 && (double) cjk / meaningful > 0.3;
    }

    public static String clean(String text) {
        return stripHtml(text);
    }

    public static String collapse(String text) {
        if (text == null) {
            return "";
        }
        return text.replaceAll("[\\s\\u00a0]+", " ").trim();
    }

    /** 按码点截断，避免截断代理对。 */
    public static String truncate(String text, int maxCodePoints) {
        String value = text == null ? "" : text;
        if (maxCodePoints <= 0) {
            return "";
        }
        int count = value.codePointCount(0, value.length());
        if (count <= maxCodePoints) {
            return value;
        }
        return value.substring(0, value.offsetByCodePoints(0, maxCodePoints))
                + "…";
    }

    /** Markdown 链接文字里的 {@code [ ]} 必须转义，否则链接会断掉。 */
    public static String escapeLinkText(String text) {
        return text == null ? "" : text.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]");
    }

    /** 目标 URL 含空格/括号时用 {@code <...>} 包裹（CommonMark 允许）。 */
    public static String linkDestination(String url) {
        String value = url == null ? "" : url.trim();
        boolean needsAngle = value.isEmpty() || value.chars().anyMatch(c -> c <= ' ' || c == '(' || c == ')'
                || c == '<' || c == '>');
        return needsAngle ? "<" + value + ">" : value;
    }

    static String decodeEntities(String text) {
        String value = text
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&apos;", "'");
        return decodeNumericEntities(value);
    }

    private static String decodeNumericEntities(String text) {
        StringBuilder out = new StringBuilder(text.length());
        int index = 0;
        while (index < text.length()) {
            int start = text.indexOf("&#", index);
            int end = start < 0 ? -1 : text.indexOf(';', start);
            if (start < 0 || end < 0 || end - start > 10) {
                out.append(text, index, text.length());
                break;
            }
            out.append(text, index, start);
            String body = text.substring(start + 2, end);
            try {
                int codePoint = body.toLowerCase(Locale.ROOT).startsWith("x")
                        ? Integer.parseInt(body.substring(1), 16)
                        : Integer.parseInt(body);
                out.appendCodePoint(codePoint);
            } catch (RuntimeException e) {
                out.append(text, start, end + 1);
            }
            index = end + 1;
        }
        return out.toString();
    }
}

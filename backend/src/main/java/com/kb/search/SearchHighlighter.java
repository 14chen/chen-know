package com.kb.search;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 在**原文**上自行计算 {@code <em>} 高亮（SCHEMA §2）。
 *
 * <p>不得使用 FTS5 的 {@code snippet()} / {@code highlight()}：它们返回的是归一化后的
 * {@code search_blob}（汉字之间带空格），不适合展示。
 *
 * <p>词元切分与 {@link com.kb.common.SearchText#toMatchExpression} 对齐：
 * 连续汉字段、连续字母数字段各自作为一个字面词，其它字符当分隔符丢弃。
 *
 * <p><b>性能约定</b>（DEF-E3-001）：只对**摘录窗口**做高亮，不按全文长度分配数组、
 * 不反复全文扫描。调用方（{@link SearchRepository}）只取命中词附近的窗口文本。
 *
 * <p><b>中文短语语义</b>（DEF-E4-003）：FTS5 把汉字逐字索引成短语，所以「天气很」会命中
 * 「天气，很好」这类原文里并不连续出现的文本。这里对汉字词额外支持"按字出现、允许中间有
 * 非汉字分隔符"的匹配，保证高亮与检索语义一致。
 */
public final class SearchHighlighter {

    private static final String OPEN = "<em>";
    private static final String CLOSE = "</em>";
    private static final char ELLIPSIS = '…';

    /** snippet 默认半径：命中处前后各 40 个字符。 */
    public static final int SNIPPET_RADIUS = 40;

    private SearchHighlighter() {
    }

    /** 一次算好的两个展示字段。 */
    public record Rendered(String html, String markdown) {
    }

    /** 从用户输入中抽出可直接在原文里查找的字面词，保持出现顺序并去重。 */
    public static List<String> terms(String query) {
        if (query == null || query.isEmpty()) {
            return List.of();
        }
        List<String> terms = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        StringBuilder run = new StringBuilder();
        int runType = 0;
        for (int i = 0; i < query.length(); ) {
            int cp = query.codePointAt(i);
            i += Character.charCount(cp);
            int type = typeOf(cp);
            if (type == 0) {
                flush(run, runType, terms, seen);
                runType = 0;
                continue;
            }
            if (run.length() > 0 && type != runType) {
                flush(run, runType, terms, seen);
            }
            runType = type;
            run.appendCodePoint(cp);
        }
        flush(run, runType, terms, seen);
        return terms;
    }

    /** 整段高亮（标题用）：文本本身很短，按整段处理。 */
    public static String highlight(String text, List<String> terms) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        boolean[] marked = markRange(text, 0, text.length(), terms);
        return renderHtml(text, marked, 0, text.length(), 0);
    }

    /** 正文片段：以首个命中位置为中心开窗，窗口内高亮，两端补省略号。 */
    public static String snippet(String text, List<String> terms, int maxLength) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        int width = Math.max(1, maxLength);
        Window window = window(text, terms, width / 4, width);
        return renderHtml(text, markRange(text, window.start(), window.end(), terms),
                window.start(), window.end(), window.start());
    }

    /** 前端用的命中片段：围绕第一个命中前后各 {@code radius} 个字符，命中处用 markdown 粗体。 */
    public static String markdownSnippet(String text, List<String> terms, int radius) {
        if (text == null || text.isEmpty() || terms == null || terms.isEmpty()) {
            return null;
        }
        Window window = markdownWindow(text, terms, Math.max(1, radius));
        if (window == null) {
            return null;                                   // 只命中标题/标签
        }
        return renderMarkdown(text, markRange(text, window.start(), window.end(), terms),
                window.start(), window.end());
    }

    /**
     * 一次算出 HTML 片段与 markdown 片段：窗口与命中标记都只算一次。
     *
     * @return {@code markdown} 为 null 表示正文没有命中（只命中标题/标签）
     */
    public static Rendered render(String text, List<String> terms, int snippetLength, int radius) {
        if (text == null || text.isEmpty()) {
            return new Rendered("", null);
        }
        int width = Math.max(1, snippetLength);
        Window htmlWindow = window(text, terms, width / 4, width);
        boolean[] marked = markRange(text, htmlWindow.start(), htmlWindow.end(), terms);
        String html = renderHtml(text, marked, htmlWindow.start(), htmlWindow.end(), htmlWindow.start());

        Window markdownWindow = markdownWindow(text, terms, Math.max(1, radius), htmlWindow);
        if (markdownWindow == null) {
            return new Rendered(html, null);
        }
        boolean[] mdMarked = markdownWindow.start() == htmlWindow.start() && markdownWindow.end() == htmlWindow.end()
                ? marked
                : markRange(text, markdownWindow.start(), markdownWindow.end(), terms);
        return new Rendered(html, renderMarkdown(text, mdMarked, markdownWindow.start(), markdownWindow.end()));
    }

    /* ---------------- 窗口与匹配 ---------------- */

    private record Window(int start, int end) {
    }

    /** 高亮窗口：以首个命中为中心，{@code pad} 为命中前的留白，总长 {@code maxLength}。 */
    private static Window window(String text, List<String> terms, int pad, int maxLength) {
        int n = text.length();
        int[] hit = firstHit(text, terms);
        if (hit == null) {
            return new Window(0, Math.min(n, maxLength));
        }
        int start = Math.max(0, hit[0] - Math.max(0, pad));
        int end = Math.min(n, start + maxLength);
        if (end - start < maxLength) {
            start = Math.max(0, end - maxLength);
        }
        return new Window(start, end);
    }

    /** markdown 窗口：命中前后各 radius；正文无命中返回 null。 */
    private static Window markdownWindow(String text, List<String> terms, int radius) {
        return markdownWindow(text, terms, radius, null);
    }

    private static Window markdownWindow(String text, List<String> terms, int radius, Window known) {
        int n = text.length();
        int[] hit = known != null ? firstHitIn(text, terms, known.start(), known.end()) : firstHit(text, terms);
        if (hit == null) {
            return null;
        }
        int start = Math.max(0, hit[0] - radius);
        int end = Math.min(n, hit[1] + radius);
        // 不要把代理对切成半个
        if (start > 0 && Character.isLowSurrogate(text.charAt(start))) {
            start--;
        }
        if (end < n && end > 0 && Character.isHighSurrogate(text.charAt(end - 1))) {
            end++;
        }
        return new Window(start, end);
    }

    /** 首个命中的 {@code [start, endExclusive)}；无命中返回 null。 */
    private static int[] firstHit(String text, List<String> terms) {
        return firstHitIn(text, terms, 0, text.length());
    }

    private static int[] firstHitIn(String text, List<String> terms, int from, int to) {
        if (terms == null || terms.isEmpty() || to <= from) {
            return null;
        }
        for (String term : terms) {
            if (term == null || term.isEmpty()) {
                continue;
            }
            int index = indexOfIgnoreCase(text, term, from, to);
            if (index >= 0) {
                return new int[] {index, index + term.length()};
            }
            int[] span = hanPhraseSpan(text, term, from, to);
            if (span != null) {
                return span;
            }
        }
        return null;
    }

    /**
     * 汉字短语匹配：term 里的汉字按顺序出现在 text 里即可（中间允许非汉字分隔符）。
     * 非纯汉字 term 返回 null（交给字面匹配）。
     */
    private static int[] hanPhraseSpan(String text, String term, int from, int to) {
        int termLen = term.length();
        if (termLen < 2) {
            return null;
        }
        for (int i = 0; i < termLen; i++) {
            if (typeOf(term.charAt(i)) != 1) {
                return null;
            }
        }
        int matched = 0;
        int start = -1;
        int i = Math.max(0, from);
        while (i < to) {
            char c = text.charAt(i);
            if (typeOf(c) == 1) {
                if (c == term.charAt(matched)) {
                    if (matched == 0) {
                        start = i;
                    }
                    matched++;
                    if (matched == termLen) {
                        return new int[] {start, i + 1};
                    }
                } else if (matched > 0) {
                    // 重新从当前字开始比对（处理「天天气」这类重叠）
                    matched = c == term.charAt(0) ? 1 : 0;
                    start = matched > 0 ? i : -1;
                }
            }
            i++;
        }
        return null;
    }

    /** 在 {@code [start, end)} 内标记所有命中；数组长度 = 窗口长度，不是全文长度。 */
    private static boolean[] markRange(String text, int start, int end, List<String> terms) {
        int length = Math.max(0, end - start);
        boolean[] marked = new boolean[length];
        if (terms == null || terms.isEmpty()) {
            return marked;
        }
        for (String term : terms) {
            if (term == null || term.isEmpty()) {
                continue;
            }
            int from = start;
            while (from <= end - term.length()) {
                int index = indexOfIgnoreCase(text, term, from, end);
                if (index < 0) {
                    break;
                }
                for (int i = index; i < index + term.length(); i++) {
                    marked[i - start] = true;
                }
                from = index + term.length();
            }
            markHanPhrase(text, term, start, end, marked);
        }
        return marked;
    }

    /** 汉字短语的逐字标记（与 {@link #hanPhraseSpan} 同语义，用于渲染）。 */
    private static void markHanPhrase(String text, String term, int start, int end, boolean[] marked) {
        int termLen = term.length();
        if (termLen < 2) {
            return;
        }
        for (int i = 0; i < termLen; i++) {
            if (typeOf(term.charAt(i)) != 1) {
                return;
            }
        }
        int matched = 0;
        int spanStart = -1;
        int last = -1;
        int i = start;
        while (i < end) {
            char c = text.charAt(i);
            if (typeOf(c) == 1) {
                if (c == term.charAt(matched)) {
                    if (matched == 0) {
                        spanStart = i;
                    }
                    matched++;
                    last = i;
                    if (matched == termLen) {
                        for (int k = spanStart; k <= last; k++) {
                            if (typeOf(text.charAt(k)) == 1) {
                                marked[k - start] = true;
                            }
                        }
                        matched = 0;
                        spanStart = -1;
                    }
                } else if (matched > 0) {
                    matched = c == term.charAt(0) ? 1 : 0;
                    spanStart = matched > 0 ? i : -1;
                }
            }
            i++;
        }
    }

    private static String renderHtml(String text, boolean[] marked, int start, int end, int offset) {
        StringBuilder out = new StringBuilder(end - start + 16);
        boolean open = false;
        for (int i = start; i < end; i++) {
            boolean hit = marked[i - offset];
            if (hit && !open) {
                out.append(OPEN);
                open = true;
            } else if (!hit && open) {
                out.append(CLOSE);
                open = false;
            }
            appendEscaped(out, text.charAt(i));
        }
        if (open) {
            out.append(CLOSE);
        }
        return (start > 0 ? String.valueOf(ELLIPSIS) : "") + out + (end < text.length() ? String.valueOf(ELLIPSIS) : "");
    }

    private static String renderMarkdown(String text, boolean[] marked, int start, int end) {
        StringBuilder out = new StringBuilder(end - start + 16);
        if (start > 0) {
            out.append(ELLIPSIS);
        }
        boolean open = false;
        for (int i = start; i < end; i++) {
            boolean hit = marked[i - start];
            if (hit && !open) {
                out.append("**");
                open = true;
            } else if (!hit && open) {
                out.append("**");
                open = false;
            }
            out.append(text.charAt(i));
        }
        if (open) {
            out.append("**");
        }
        if (end < text.length()) {
            out.append(ELLIPSIS);
        }
        return out.toString();
    }

    private static void appendEscaped(StringBuilder out, char c) {
        switch (c) {
            case '&' -> out.append("&amp;");
            case '<' -> out.append("&lt;");
            case '>' -> out.append("&gt;");
            case '"' -> out.append("&quot;");
            case '\'' -> out.append("&#39;");
            default -> out.append(c);
        }
    }

    /** 在 {@code [from, to)} 内做大小写不敏感的字面查找（先原生 indexOf，再退回逐位比对）。 */
    private static int indexOfIgnoreCase(String text, String needle, int from, int to) {
        int last = Math.min(to, text.length()) - needle.length();
        if (last < from) {
            return -1;
        }
        int exact = text.indexOf(needle, from);
        if (exact >= 0 && exact <= last) {
            return exact;
        }
        for (int i = Math.max(0, from); i <= last; i++) {
            if (text.regionMatches(true, i, needle, 0, needle.length())) {
                return i;
            }
        }
        return -1;
    }

    /** 0 = 分隔符，1 = 汉字，2 = 字母数字下划线。 */
    private static int typeOf(int codePoint) {
        if (Character.UnicodeScript.of(codePoint) == Character.UnicodeScript.HAN) {
            return 1;
        }
        return Character.isLetterOrDigit(codePoint) || codePoint == '_' ? 2 : 0;
    }

    private static void flush(StringBuilder run, int type, List<String> terms, Set<String> seen) {
        if (run.length() == 0) {
            return;
        }
        String term = run.toString();
        run.setLength(0);
        if (type != 0 && seen.add(term.toLowerCase(Locale.ROOT))) {
            terms.add(term);
        }
    }
}

package com.kb.ioport;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * IMPORT-IMAGES.md §3：从 Markdown 正文里找出图片引用。
 *
 * <p>支持 {@code ![alt](target)}、{@code ![alt](target "title")}、{@code ![](<target with spaces>)}
 * 与 {@code <img src="target">}；{@code ![alt][ref]} 引用式写法只报告不改写（§3.1）。
 * 外部地址 / data: / 我们自己的附件地址在 {@link #isExternallyHandled} 里排除（§3.2）。
 */
public final class ImageRefs {

    /** 可重写的引用：{@code start}/{@code end} 是 target 文本在原文中的下标（只替换 target，保留 alt 与 title）。 */
    public record Ref(int line, String target, int start, int end) {
    }

    /** 识别到但本轮不支持改写的引用。 */
    public record UnsupportedRef(int line, String raw, String reason) {
    }

    public record Result(List<Ref> refs, List<UnsupportedRef> unsupported) {
    }

    private static final Pattern INLINE_IMAGE = Pattern.compile(
            "!\\[([^\\]]*)\\]\\(\\s*(?:<([^>\\n]*)>|([^\\s)]+))(?:\\s+(?:\"[^\"]*\"|'[^']*'|\\([^)]*\\)))?\\s*\\)");
    private static final Pattern HTML_IMAGE = Pattern.compile(
            "<img\\b[^>]*?\\bsrc\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", Pattern.CASE_INSENSITIVE);
    private static final Pattern REFERENCE_STYLE = Pattern.compile("!\\[([^\\]]*)\\]\\[([^\\]]*)\\]");

    private ImageRefs() {
    }

    public static Result parse(String markdown) {
        List<Ref> refs = new ArrayList<>();
        List<UnsupportedRef> unsupported = new ArrayList<>();
        if (markdown == null || markdown.isEmpty()) {
            return new Result(refs, unsupported);
        }
        collectInline(markdown, refs, unsupported);
        collectHtml(markdown, refs);
        refs.sort(Comparator.comparingInt(Ref::start));
        unsupported.sort(Comparator.comparingInt(UnsupportedRef::line));
        return new Result(refs, unsupported);
    }

    private static void collectInline(String markdown, List<Ref> refs, List<UnsupportedRef> unsupported) {
        Matcher matcher = INLINE_IMAGE.matcher(markdown);
        int cursor = 0;
        while (matcher.find()) {
            boolean angle = matcher.group(2) != null;
            String target = angle ? matcher.group(2) : matcher.group(3);
            int start = angle ? matcher.start(2) : matcher.start(3);
            int end = angle ? matcher.end(2) : matcher.end(3);
            refs.add(new Ref(lineOf(markdown, matcher.start()), target, start, end));
            cursor = matcher.end();
        }
        Matcher reference = REFERENCE_STYLE.matcher(markdown);
        while (reference.find()) {
            if (reference.start() < cursor) {
                continue;
            }
            unsupported.add(new UnsupportedRef(lineOf(markdown, reference.start()),
                    reference.group(0), MissingImage.REASON_REFERENCE_STYLE));
        }
    }

    private static void collectHtml(String markdown, List<Ref> refs) {
        Matcher matcher = HTML_IMAGE.matcher(markdown);
        while (matcher.find()) {
            boolean doubleQuoted = matcher.group(1) != null;
            String target = doubleQuoted ? matcher.group(1) : matcher.group(2);
            int start = doubleQuoted ? matcher.start(1) : matcher.start(2);
            int end = doubleQuoted ? matcher.end(1) : matcher.end(2);
            refs.add(new Ref(lineOf(markdown, matcher.start()), target, start, end));
        }
    }

    /** §3.2：外部地址、内联数据与我们自己的附件地址一律原样保留，不算缺失、不改写。 */
    static boolean isExternallyHandled(String rawTarget) {
        String target = stripAngle(rawTarget).trim().toLowerCase(Locale.ROOT);
        return target.isEmpty()
                || target.startsWith("http://")
                || target.startsWith("https://")
                || target.startsWith("//")
                || target.startsWith("data:")
                || target.startsWith("/api/attachments/");
    }

    /** 去掉 {@code < >} 包裹。 */
    static String stripAngle(String target) {
        String text = target == null ? "" : target.trim();
        if (text.length() >= 2 && text.startsWith("<") && text.endsWith(">")) {
            return text.substring(1, text.length() - 1).trim();
        }
        return text;
    }

    /**
     * §3.3 归一化：URL-decode → 去 query/fragment → 相对 {@code dirname(mdPath)} 解析 → 得到
     * 不含 {@code ..}、盘符与前导斜杠的相对路径。
     *
     * @throws IllegalArgumentException 路径非法（越界 / 盘符 / 空）
     */
    static String normalizeTarget(String mdPath, String rawTarget) {
        String target = percentDecode(stripAngle(rawTarget));
        int cut = target.length();
        int query = target.indexOf('?');
        int fragment = target.indexOf('#');
        if (query >= 0) {
            cut = Math.min(cut, query);
        }
        if (fragment >= 0) {
            cut = Math.min(cut, fragment);
        }
        target = target.substring(0, cut).trim();
        if (target.isEmpty() || target.indexOf(':') >= 0) {
            throw new IllegalArgumentException(MissingImage.REASON_ILLEGAL_PATH);
        }
        // 以 / 开头 → 相对仓库根
        String combined = target.startsWith("/") ? target.substring(1) : dirname(mdPath) + "/" + target;
        List<String> segments = new ArrayList<>();
        for (String segment : combined.split("/")) {
            if (segment.isEmpty() || ".".equals(segment)) {
                continue;
            }
            if ("..".equals(segment)) {
                if (segments.isEmpty()) {
                    throw new IllegalArgumentException(MissingImage.REASON_ILLEGAL_PATH);
                }
                segments.remove(segments.size() - 1);
                continue;
            }
            segments.add(segment);
        }
        if (segments.isEmpty()) {
            throw new IllegalArgumentException(MissingImage.REASON_ILLEGAL_PATH);
        }
        return String.join("/", segments);
    }

    static String dirname(String path) {
        if (path == null) {
            return "";
        }
        int slash = path.lastIndexOf('/');
        return slash < 0 ? "" : path.substring(0, slash);
    }

    /** 只解 {@code %XX}（不把 {@code +} 当空格，文件名里的 + 必须保留）；非百分号部分按 UTF-8 原样保留。 */
    static String percentDecode(String text) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(text.length());
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '%' && i + 2 < text.length()) {
                int high = Character.digit(text.charAt(i + 1), 16);
                int low = Character.digit(text.charAt(i + 2), 16);
                if (high >= 0 && low >= 0) {
                    out.write((high << 4) + low);
                    i += 2;
                    continue;
                }
            }
            out.writeBytes(String.valueOf(c).getBytes(StandardCharsets.UTF_8));
        }
        return out.toString(StandardCharsets.UTF_8);
    }

    private static int lineOf(String markdown, int offset) {
        int line = 1;
        for (int i = 0; i < offset && i < markdown.length(); i++) {
            if (markdown.charAt(i) == '\n') {
                line++;
            }
        }
        return line;
    }
}

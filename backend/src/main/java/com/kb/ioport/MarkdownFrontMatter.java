package com.kb.ioport;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * API.md §10 的 YAML front matter 最小实现：只认 {@code title} / {@code tags} / {@code folder}
 * 三个键，值支持 {@code key: value}、{@code tags: [a, b]} 与 {@code - item} 块列表。
 *
 * <p>不完整的 front matter（没有闭合的 {@code ---}）按普通正文处理，不报错。
 */
public final class MarkdownFrontMatter {

    /** 解析出的三个键；缺省为 null / 空列表。 */
    public record FrontMatter(String title, List<String> tags, String folder) {

        static final FrontMatter EMPTY = new FrontMatter(null, List.of(), null);
    }

    /** {@code body} 是去掉 front matter 后的正文。 */
    public record Parsed(FrontMatter frontMatter, String body) {
    }

    private MarkdownFrontMatter() {
    }

    public static Parsed parse(String text) {
        String source = text.startsWith("\uFEFF") ? text.substring(1) : text;
        int firstLineEnd = lineEnd(source, 0);
        if (!isFence(source, 0, firstLineEnd) || firstLineEnd >= source.length()) {
            return new Parsed(FrontMatter.EMPTY, source);
        }
        int blockStart = firstLineEnd + 1;
        int position = blockStart;
        while (position <= source.length()) {
            int end = lineEnd(source, position);
            if (isFence(source, position, end)) {
                return new Parsed(parseBlock(source.substring(blockStart, position)),
                        stripSeparatorNewline(source.substring(end < source.length() ? end + 1 : end)));
            }
            if (end >= source.length()) {
                break;
            }
            position = end + 1;
        }
        return new Parsed(FrontMatter.EMPTY, source);
    }

    /**
     * front matter 与正文之间那个空行属于分隔符，不属于正文 —— 否则「导出 → 再导入」会在正文
     * 开头凭空多出一个换行（往返后正文就不再逐字一致）。
     */
    private static String stripSeparatorNewline(String body) {
        if (body.startsWith("\r\n")) {
            return body.substring(2);
        }
        return body.startsWith("\n") ? body.substring(1) : body;
    }

    private static FrontMatter parseBlock(String block) {
        String title = null;
        String folder = null;
        List<String> tags = new ArrayList<>();
        boolean collectingList = false;
        for (String rawLine : block.split("\n", -1)) {
            String line = rawLine.strip();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            if (collectingList && line.startsWith("- ")) {
                tags.add(unquote(line.substring(2).strip()));
                continue;
            }
            int colon = line.indexOf(':');
            if (colon < 0) {
                collectingList = false;
                continue;
            }
            String key = line.substring(0, colon).strip().toLowerCase(Locale.ROOT);
            String value = line.substring(colon + 1).strip();
            if (value.isEmpty()) {
                collectingList = "tags".equals(key);
                continue;
            }
            collectingList = false;
            switch (key) {
                case "title" -> title = blankToNull(unquote(value));
                case "folder" -> folder = blankToNull(unquote(value));
                case "tags" -> tags.addAll(parseList(value));
                default -> {
                    // 其它键（author/date 等）忽略
                }
            }
        }
        tags.removeIf(tag -> tag == null || tag.isBlank());
        return new FrontMatter(title, List.copyOf(tags), folder);
    }

    private static List<String> parseList(String value) {
        String inner = value.strip();
        if (inner.startsWith("[") && inner.endsWith("]")) {
            inner = inner.substring(1, inner.length() - 1);
        }
        List<String> values = new ArrayList<>();
        for (String part : inner.split(",")) {
            String item = blankToNull(unquote(part.strip()));
            if (item != null) {
                values.add(item);
            }
        }
        return values;
    }

    private static String unquote(String value) {
        if (value.length() >= 2) {
            char first = value.charAt(0);
            char last = value.charAt(value.length() - 1);
            if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
                return value.substring(1, value.length() - 1)
                        .replace("\\\\", "\\")
                        .replace("\\" + first, String.valueOf(first));
            }
        }
        return value;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static int lineEnd(String source, int from) {
        if (from >= source.length()) {
            return source.length();
        }
        int index = source.indexOf('\n', from);
        return index < 0 ? source.length() : index;
    }

    private static boolean isFence(String source, int start, int end) {
        return start <= end && "---".equals(source.substring(start, end).strip());
    }
}

package com.kb.digest;

import java.util.ArrayList;
import java.util.List;

/**
 * 抽取式速览：标题行 + 前 3 个「有内容」段落的首句。纯函数、只读。
 *
 * <p>跳过代码块、列表、表格、图片、引用行，避免把排版噪音当正文。
 * <b>绝不修改正文</b>。
 */
public final class DigestExtractor {

    /** 少于此长度不做速览（正文本身就很短，没必要）。 */
    public static final int MIN_CONTENT_CHARS = 800;
    /** 单条上限。 */
    public static final int MAX_SECTION_CHARS = 80;
    /** 总长上限。 */
    public static final int MAX_TOTAL_CHARS = 300;
    /** 取几个段落。 */
    public static final int MAX_SECTIONS = 3;

    private DigestExtractor() {
    }

    /** @return 正文太短/无可用内容时返回 {@code null} */
    public static Digest extract(String content) {
        if (content == null || content.isBlank()) {
            return null;
        }
        if (content.codePointCount(0, content.length()) < MIN_CONTENT_CHARS) {
            return null;
        }
        List<String> sections = new ArrayList<>(MAX_SECTIONS + 1);
        String heading = firstHeading(content);
        if (heading != null) {
            sections.add(heading);
        }
        for (String paragraph : paragraphs(content)) {
            String sentence = firstSentence(paragraph);
            if (sentence != null && !sections.contains(sentence)) {
                sections.add(sentence);
            }
            if (sections.size() >= (heading == null ? MAX_SECTIONS : MAX_SECTIONS + 1)) {
                break;
            }
        }
        if (sections.isEmpty()) {
            return null;
        }
        // 超长时从尾部整条丢弃（不截断句子）
        while (sections.size() > 1 && totalLength(sections) > MAX_TOTAL_CHARS) {
            sections.remove(sections.size() - 1);
        }
        if (totalLength(sections) > MAX_TOTAL_CHARS) {
            sections.set(0, truncate(sections.get(0), MAX_TOTAL_CHARS));
        }
        return new Digest(String.join("\n", sections), List.copyOf(sections));
    }

    /** 第一个非空的 Markdown 标题行（去掉 # 前缀）。 */
    static String firstHeading(String content) {
        for (String raw : content.split("\n", -1)) {
            String line = raw.trim();
            if (!line.startsWith("#")) {
                continue;
            }
            String text = line.replaceAll("^#+\\s*", "").trim();
            if (!text.isEmpty()) {
                return truncate(text, MAX_SECTION_CHARS);
            }
        }
        return null;
    }

    /** 按空行切段，并丢掉代码块/列表/表格/图片/引用这类非正文段。 */
    static List<String> paragraphs(String content) {
        List<String> paragraphs = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inCode = false;
        for (String raw : content.split("\n", -1)) {
            String line = raw.stripTrailing();
            String trimmed = line.trim();
            if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
                inCode = !inCode;
                flush(current, paragraphs);
                continue;
            }
            if (inCode) {
                continue;
            }
            if (trimmed.isEmpty()) {
                flush(current, paragraphs);
                continue;
            }
            if (isNonProse(trimmed)) {
                flush(current, paragraphs);
                continue;
            }
            if (current.length() > 0) {
                current.append(' ');
            }
            current.append(trimmed);
        }
        flush(current, paragraphs);
        return paragraphs;
    }

    static boolean isNonProse(String trimmed) {
        if (trimmed.startsWith("#") || trimmed.startsWith(">")) {
            return true;                                     // 标题/引用
        }
        if (trimmed.startsWith("![") || trimmed.startsWith("[![") || trimmed.startsWith("|")) {
            return true;                                     // 图片/表格
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ")
                || trimmed.matches("^\\d+[.)]\\s.*")) {
            return true;                                     // 列表/有序列表
        }
        return trimmed.matches("^[-*_]{3,}$");               // 分割线
    }

    private static void flush(StringBuilder current, List<String> paragraphs) {
        if (current.length() > 0) {
            paragraphs.add(current.toString());
            current.setLength(0);
        }
    }

    /** 段落首句：遇到中英文句末标点即止，最长 {@link #MAX_SECTION_CHARS}。 */
    static String firstSentence(String paragraph) {
        if (paragraph == null || paragraph.isBlank()) {
            return null;
        }
        String text = paragraph.trim();
        int end = text.length();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '。' || c == '！' || c == '？' || c == '!' || c == '?') {
                end = i + 1;
                break;
            }
            if (c == '.' && (i + 1 == text.length() || Character.isWhitespace(text.charAt(i + 1)))) {
                end = i + 1;
                break;
            }
        }
        String sentence = text.substring(0, end).trim();
        if (sentence.isEmpty()) {
            return null;
        }
        return truncate(sentence, MAX_SECTION_CHARS);
    }

    private static int totalLength(List<String> sections) {
        int total = 0;
        for (String section : sections) {
            total += section.codePointCount(0, section.length());
        }
        return total + Math.max(0, sections.size() - 1);     // 换行算 1 个字
    }

    static String truncate(String text, int maxCodePoints) {
        if (text.codePointCount(0, text.length()) <= maxCodePoints) {
            return text;
        }
        int end = text.offsetByCodePoints(0, maxCodePoints - 1);
        return text.substring(0, end) + "…";
    }
}

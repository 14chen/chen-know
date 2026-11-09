package com.kb.common;

/**
 * 中文全文检索文本处理（SCHEMA §2）。
 *
 * <p>策略：CJK 逐字加空格 + {@code unicode61} + 短语查询，不使用 trigram。
 * 写入 {@code notes.search_blob} 前用 {@link #normalize}，
 * 查询时用 {@link #toMatchExpression} 生成 FTS5 MATCH 表达式。
 *
 * <p><b>注意</b>：本类是所有搜索功能的地基，写入方与查询方必须共用同一份实现。
 * SCHEMA §2 写的是 {@code com.kb.search.SearchText}，实际落在 {@code com.kb.common}
 * （调度分配），包名差异不影响契约语义，已回报 Lead。
 */
public final class SearchText {

    /** FTS5 里被当作布尔运算符的裸词，必须加引号，否则用户输入会被当成查询语法。 */
    private static final String[] RESERVED_WORDS = {"AND", "OR", "NOT", "NEAR"};

    private SearchText() {
    }

    /**
     * 生成 search_blob：汉字逐字用空格隔开，其余字符原样保留；连续空白折叠为单个空格。
     *
     * <pre>
     * 今天天气很好，Spring Boot 笔记   -&gt;   今 天 天 气 很 好 ，Spring Boot 笔 记
     * </pre>
     */
    public static String normalize(String text) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        StringBuilder raw = new StringBuilder(text.length() * 2);
        text.codePoints().forEach(cp -> {
            if (isHan(cp)) {
                raw.append(' ').appendCodePoint(cp).append(' ');
            } else {
                raw.appendCodePoint(cp);
            }
        });
        StringBuilder collapsed = new StringBuilder(raw.length());
        boolean pendingSpace = false;
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (Character.isWhitespace(c)) {
                pendingSpace = collapsed.length() > 0;
            } else {
                if (pendingSpace) {
                    collapsed.append(' ');
                    pendingSpace = false;
                }
                collapsed.append(c);
            }
        }
        return collapsed.toString();
    }

    /**
     * 把用户输入转成 FTS5 MATCH 表达式。
     *
     * <pre>
     * 天气        -&gt;  "天 气"
     * spring boot -&gt;  spring boot
     * Spring笔记  -&gt;  Spring "笔 记"
     * </pre>
     *
     * <p>除汉字、字母、数字、下划线、双引号以外的字符（{@code * " ( ) : ^ -} 等 FTS5 语法元字符）
     * 一律作为分隔符丢弃；引号会被 {@link #escapeQuotes} 转义后包进引号字符串，
     * 因此用户输入无法构造出 FTS5 语法，也不会造成 SQL 注入（表达式始终作为绑定参数传入）。
     *
     * @return 表达式；输入为空或全无有效字符时返回空串，调用方此时应退化为普通列表查询
     */
    public static String toMatchExpression(String userQuery) {
        if (userQuery == null || userQuery.isEmpty()) {
            return "";
        }
        StringBuilder out = new StringBuilder(userQuery.length() * 2);
        StringBuilder hanRun = new StringBuilder();
        StringBuilder wordRun = new StringBuilder();
        int i = 0;
        while (i < userQuery.length()) {
            int cp = userQuery.codePointAt(i);
            i += Character.charCount(cp);
            if (isHan(cp)) {
                flushWord(wordRun, out);
                if (hanRun.length() > 0) {
                    hanRun.append(' ');
                }
                hanRun.appendCodePoint(cp);
            } else if (isWordChar(cp)) {
                flushHan(hanRun, out);
                wordRun.appendCodePoint(cp);
            } else {
                flushHan(hanRun, out);
                flushWord(wordRun, out);
            }
        }
        flushHan(hanRun, out);
        flushWord(wordRun, out);
        return out.toString().trim();
    }

    /** FTS5 双引号字符串内的转义规则：{@code "} 写成 {@code ""}。 */
    public static String escapeQuotes(String text) {
        return text == null ? "" : text.replace("\"", "\"\"");
    }

    private static void flushHan(StringBuilder hanRun, StringBuilder out) {
        if (hanRun.length() == 0) {
            return;
        }
        appendSeparator(out);
        out.append('"').append(hanRun).append('"');
        hanRun.setLength(0);
    }

    private static void flushWord(StringBuilder wordRun, StringBuilder out) {
        if (wordRun.length() == 0) {
            return;
        }
        String word = wordRun.toString();
        wordRun.setLength(0);
        if (word.replace("\"", "").isEmpty()) {
            // 只有引号，没有任何可检索内容
            return;
        }
        appendSeparator(out);
        if (isPlainToken(word)) {
            out.append(word);
        } else {
            out.append('"').append(escapeQuotes(word)).append('"');
        }
    }

    private static void appendSeparator(StringBuilder out) {
        if (out.length() > 0) {
            out.append(' ');
        }
    }

    /** 无需加引号即可安全下发的裸 token：纯 ASCII 字母数字下划线且不是 FTS5 保留词。 */
    private static boolean isPlainToken(String word) {
        for (int i = 0; i < word.length(); i++) {
            char c = word.charAt(i);
            boolean plain = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
            if (!plain) {
                return false;
            }
        }
        for (String reserved : RESERVED_WORDS) {
            if (reserved.equalsIgnoreCase(word)) {
                return false;
            }
        }
        return true;
    }

    private static boolean isWordChar(int cp) {
        return Character.isLetterOrDigit(cp) || cp == '_' || cp == '"';
    }

    /** 汉字（含扩展区与兼容区）；日文假名、谚文不在本知识库的检索范围内。 */
    static boolean isHan(int cp) {
        return (cp >= 0x3400 && cp <= 0x4DBF)        // CJK 扩展 A
                || (cp >= 0x4E00 && cp <= 0x9FFF)    // CJK 基本区
                || (cp >= 0xF900 && cp <= 0xFAFF)    // 兼容汉字
                || (cp >= 0x20000 && cp <= 0x2FA1F); // 扩展 B~F 及补充
    }
}

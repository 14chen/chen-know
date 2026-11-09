package com.kb.note;

/**
 * Markdown → 纯文本（SCHEMA §1：{@code notes.excerpt} = 剥离 Markdown 语法后的纯文本前 200 字）。
 *
 * <p>只做展示用的轻量剥离，不追求 Markdown 完整语义：去掉围栏代码块、行内反引号、
 * 标题/引用/列表标记、图片、链接目标、HTML 标签与强调符号，最后折叠空白。
 *
 * <p>同时是「正文 → 可检索纯文本」的共用工具：{@link #stripTags} 被摘要与
 * {@code search_blob} 共用（EDITOR-FORMAT §8）。
 */
public final class Excerpt {

    /** 契约：excerpt 取纯文本前 200 字。 */
    public static final int MAX_LENGTH = 200;

    private Excerpt() {
    }

    /** 前 {@value #MAX_LENGTH} 个码点（超长时不会截断代理对）。 */
    public static String of(String markdown) {
        return head(plain(markdown), MAX_LENGTH);
    }

    /** 整段纯文本（空白折叠为单个空格并 trim）。 */
    public static String plain(String markdown) {
        if (markdown == null || markdown.isEmpty()) {
            return "";
        }
        String text = stripFencedCode(markdown);
        text = text.replace("`", "");
        text = text.replaceAll("!\\[[^\\]]*\\]\\([^)]*\\)", " ");          // 图片
        text = text.replaceAll("\\[([^\\]]*)\\]\\([^)]*\\)", "$1");        // 行内链接保留文字
        text = text.replaceAll("\\[([^\\]]*)\\]\\[[^\\]]*\\]", "$1");      // 引用式链接
        text = text.replaceAll("(?m)^\\s{0,3}#{1,6}\\s*", "");             // 标题
        text = text.replaceAll("(?m)^\\s{0,3}>\\s?", "");                  // 引用
        text = text.replaceAll("(?m)^\\s{0,3}(?:[-*+]|\\d{1,3}[.)])\\s+", ""); // 列表标记
        text = text.replaceAll("(?m)^\\s*([-*_])\\1{2,}\\s*$", "");        // 分隔线
        text = stripTags(text);                                            // HTML 标签
        text = text.replaceAll("\\*+", "");                                // 粗体/斜体标记
        text = text.replaceAll("~+", "");                                  // 删除线标记
        text = text.replaceAll("(?<![\\p{L}\\p{N}])_+|_+(?![\\p{L}\\p{N}])", "");
        text = text.replace('|', ' ');                                     // 表格分隔
        return text.replaceAll("\\s+", " ").trim();
    }

    /**
     * 剥离内联 HTML 标签：编辑器写入的 {@code <mark>}/{@code <u>}/{@code <span style="color:#rrggbb">}
     * 等（EDITOR-FORMAT §2）。
     *
     * <p><b>只有这一份实现</b>：摘要（{@link #plain}）与搜索索引 {@code notes.search_blob}
     * （{@link NoteService} 的三处写入口）都走这里 —— 两边规则一旦分叉，就会出现
     * 「摘要干净但能搜到 span/color」这类问题。
     */
    public static String stripTags(String text) {
        return text == null ? "" : text.replaceAll("<[^>]{1,200}>", " ");
    }

    /** 围栏代码块整体丢弃（含围栏行），避免代码喧宾夺主。 */
    private static String stripFencedCode(String text) {
        StringBuilder out = new StringBuilder(text.length());
        String fence = null;
        for (String line : text.split("\n", -1)) {
            String trimmed = line.stripLeading();
            if (fence == null) {
                if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
                    fence = trimmed.substring(0, 3);
                    continue;
                }
                out.append(line).append('\n');
            } else if (trimmed.startsWith(fence)) {
                fence = null;
            }
        }
        return out.toString();
    }

    private static String head(String text, int maxCodePoints) {
        int count = text.codePointCount(0, text.length());
        if (count <= maxCodePoints) {
            return text;
        }
        return text.substring(0, text.offsetByCodePoints(0, maxCodePoints));
    }
}

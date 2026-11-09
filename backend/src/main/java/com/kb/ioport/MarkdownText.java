package com.kb.ioport;

/**
 * Markdown 文本工具：H1 标题提取（导入的标题回退链用）。
 *
 * <p>{@code notes.excerpt} 不在本类实现 —— 摘要口径归 note 模块，
 * 导入直接复用 {@code com.kb.note.Excerpt#of}，避免两份实现漂移。
 */
public final class MarkdownText {

    private MarkdownText() {
    }

    /** 第一个 {@code # 一级标题}（跳过围栏代码块内）；没有则返回 null。 */
    public static String firstHeading(String markdown) {
        if (markdown == null) {
            return null;
        }
        boolean inFence = false;
        for (String rawLine : markdown.split("\n", -1)) {
            String line = rawLine.strip();
            if (line.startsWith("```") || line.startsWith("~~~")) {
                inFence = !inFence;
                continue;
            }
            if (inFence) {
                continue;
            }
            if (line.startsWith("# ")) {
                String heading = line.substring(2).strip();
                if (!heading.isEmpty()) {
                    return heading;
                }
            }
        }
        return null;
    }
}

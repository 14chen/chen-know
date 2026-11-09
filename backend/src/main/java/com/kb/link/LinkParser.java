package com.kb.link;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 从 Markdown 正文解析 {@code [[目标标题]]}（API.md §4）。
 *
 * <p>必须忽略围栏代码块与行内代码里的 {@code [[ ]]}，否则代码示例会污染反链。
 */
public final class LinkParser {

    /** 标题里不允许出现方括号，且限制单条长度，避免误吞大段正文。 */
    private static final Pattern WIKI_LINK = Pattern.compile("\\[\\[([^\\[\\]]{1,200})]]");

    /** 单行内的行内代码；跨行行内代码在 Markdown 里本就少见，不做处理。 */
    private static final Pattern INLINE_CODE = Pattern.compile("`[^`\\n]*`");

    private LinkParser() {
    }

    /** 按出现顺序返回目标标题；大小写不敏感去重，保留首次出现的原文写法。 */
    public static List<String> parseTargets(String markdown) {
        if (markdown == null || markdown.isEmpty()) {
            return List.of();
        }
        String text = stripFencedCode(markdown);
        text = INLINE_CODE.matcher(text).replaceAll(" ");
        List<String> targets = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        Matcher matcher = WIKI_LINK.matcher(text);
        while (matcher.find()) {
            String target = matcher.group(1).trim();
            if (target.isEmpty() || !seen.add(target.toLowerCase(Locale.ROOT))) {
                continue;
            }
            targets.add(target);
        }
        return targets;
    }

    /** 丢掉围栏代码块（含围栏行），其余原样保留。 */
    private static String stripFencedCode(String text) {
        StringBuilder out = new StringBuilder(text.length());
        String fence = null;
        for (String line : text.split("\n", -1)) {
            String trimmed = line.stripLeading();
            if (fence == null) {
                if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
                    fence = trimmed.substring(0, 3);
                } else {
                    out.append(line).append('\n');
                }
            } else if (trimmed.startsWith(fence)) {
                fence = null;
            }
        }
        return out.toString();
    }
}

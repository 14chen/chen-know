package com.kb.related;

import com.kb.common.SearchText;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 从一篇笔记里抽取「可用于内容相似度检索」的关键词（纯函数，便于单测）。
 *
 * <p>与 FTS 的索引口径对齐：汉字按<b>二元组</b>切（逐字索引 + 短语查询，所以「权限」能命中「权限」这两个字），
 * 拉丁词取长度 ≥3 的整词。含高频虚词的二元组会被过滤，避免「的时」「了一」这种噪音。
 */
public final class RelatedKeywords {

    /** 内容检索最多用几个词；本方案用前 {@link #FOR_MATCH} 个做 AND。 */
    public static final int MAX_KEYWORDS = 6;
    /** 真正参与 MATCH 的词数（≥2 才算「命中数 ≥2」）。 */
    public static final int FOR_MATCH = 2;

    private static final Pattern LATIN = Pattern.compile("[A-Za-z][A-Za-z0-9_+#.-]{2,}");
    private static final Set<String> STOP_CHARS = Set.of(
            "的", "了", "是", "在", "和", "有", "我", "你", "他", "她", "它", "们", "这", "那", "就",
            "都", "也", "与", "及", "之", "其", "为", "以", "于", "而", "被", "把", "对", "从", "到",
            "上", "下", "中", "个", "一", "不", "会", "可", "能", "要", "还", "很", "更", "最", "等");

    private RelatedKeywords() {
    }

    /** @return 去重后的关键词（汉字二元组优先，其次拉丁词），最多 {@link #MAX_KEYWORDS} 个 */
    public static List<String> from(String title, String content) {
        String text = (title == null ? "" : title) + "\n" + (content == null ? "" : content);
        Map<String, Integer> counts = new java.util.LinkedHashMap<>();
        List<String> cjk = bigrams(text, counts);
        cjk.sort((a, b) -> {
            int compare = Integer.compare(counts.getOrDefault(b, 0), counts.getOrDefault(a, 0));
            return compare != 0 ? compare : a.compareTo(b);
        });
        Set<String> ordered = new LinkedHashSet<>();
        for (String word : cjk) {
            if (ordered.size() >= MAX_KEYWORDS) {
                break;
            }
            ordered.add(word);
        }
        java.util.regex.Matcher matcher = LATIN.matcher(text);
        while (matcher.find() && ordered.size() < MAX_KEYWORDS) {
            String word = matcher.group();
            if (!word.equalsIgnoreCase(title == null ? "" : title.trim())) {
                ordered.add(word.toLowerCase(Locale.ROOT));
            }
        }
        return List.copyOf(ordered);
    }

    /** 汉字二元组计数：只统计「相邻两个字都是汉字且都不在停用表里」的组合。 */
    static List<String> bigrams(String text, Map<String, Integer> counts) {
        List<String> words = new ArrayList<>();
        if (text == null || text.isEmpty()) {
            return words;
        }
        int[] codePoints = text.codePoints().toArray();
        for (int index = 1; index < codePoints.length; index++) {
            int previous = codePoints[index - 1];
            int current = codePoints[index];
            if (Character.UnicodeScript.of(previous) != Character.UnicodeScript.HAN
                    || Character.UnicodeScript.of(current) != Character.UnicodeScript.HAN) {
                continue;
            }
            String first = new String(Character.toChars(previous));
            String second = new String(Character.toChars(current));
            if (STOP_CHARS.contains(first) || STOP_CHARS.contains(second)) {
                continue;
            }
            String bigram = first + second;
            counts.merge(bigram, 1, Integer::sum);
            if (!words.contains(bigram)) {
                words.add(bigram);
            }
        }
        return words;
    }

    /**
     * 构造 FTS5 MATCH 表达式：取前 {@link #FOR_MATCH} 个关键词做 <b>AND</b>，
     * 这样「命中 ≥2 个词」是查询本身保证的（不是事后猜的）。
     *
     * @return 表达式；可用关键词不足 2 个时返回 null（此时不跑内容相似度）
     */
    public static String matchExpression(List<String> keywords) {
        if (keywords == null || keywords.size() < FOR_MATCH) {
            return null;
        }
        List<String> parts = new ArrayList<>(FOR_MATCH);
        for (String keyword : keywords) {
            String expression = SearchText.toMatchExpression(keyword);
            if (!expression.isEmpty()) {
                parts.add(expression);
            }
            if (parts.size() >= FOR_MATCH) {
                break;
            }
        }
        return parts.size() < FOR_MATCH ? null : String.join(" AND ", parts);
    }
}

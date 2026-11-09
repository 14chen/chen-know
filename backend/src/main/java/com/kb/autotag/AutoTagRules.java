package com.kb.autotag;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 自动标签规则（保守优先，宁可少打不可乱打）。纯函数，便于单测。
 *
 * <ul>
 *   <li>固定词表：前端 / 后端 / 数据库 / AI / 运维 / 生活</li>
 *   <li><b>必须命中 ≥2 个不同关键词</b>才打标签（只命中 1 个一律不打）</li>
 *   <li>一篇最多 2 个标签，按命中关键词数（再按命中次数）排序取前 2</li>
 * </ul>
 */
public final class AutoTagRules {

    /** 标签名 → 关键词（5-8 个）。 */
    private static final Map<String, List<String>> KEYWORDS = buildKeywords();

    /** 至少命中几个不同关键词才认。 */
    public static final int MIN_DISTINCT_HITS = 2;
    /** 一篇最多打几个标签。 */
    public static final int MAX_TAGS = 2;

    private AutoTagRules() {
    }

    private static Map<String, List<String>> buildKeywords() {
        Map<String, List<String>> map = new LinkedHashMap<>();
        map.put("前端", List.of("前端", "组件", "React", "Vue", "CSS", "页面", "样式"));
        map.put("后端", List.of("后端", "接口", "服务端", "API", "Spring", "Java", "并发", "微服务"));
        map.put("数据库", List.of("数据库", "SQL", "索引", "迁移", "事务", "查询计划", "表结构"));
        map.put("AI", List.of("AI", "大模型", "模型", "训练", "推理", "Prompt", "LLM", "机器学习"));
        map.put("运维", List.of("运维", "部署", "Docker", "容器", "监控", "日志", "CI", "备份"));
        map.put("生活", List.of("生活", "跑步", "咖啡", "旅行", "菜谱", "心情", "家人"));
        return Map.copyOf(map);
    }

    public static Map<String, List<String>> keywords() {
        return KEYWORDS;
    }

    /** 一个标签的命中情况。 */
    public record Match(String tag, int distinctKeywords, int occurrences) {
    }

    /** @return 按规则应当打上的标签（0..2 个，可能为空） */
    public static List<String> suggest(String title, String content) {
        String text = ((title == null ? "" : title) + " " + (content == null ? "" : content));
        String lower = text.toLowerCase(Locale.ROOT);
        List<Match> matches = new ArrayList<>();
        for (Map.Entry<String, List<String>> entry : KEYWORDS.entrySet()) {
            Set<String> distinct = new LinkedHashSet<>();
            int occurrences = 0;
            for (String keyword : entry.getValue()) {
                int hits = countOccurrences(lower, keyword.toLowerCase(Locale.ROOT));
                if (hits > 0) {
                    distinct.add(keyword.toLowerCase(Locale.ROOT));
                    occurrences += hits;
                }
            }
            if (distinct.size() >= MIN_DISTINCT_HITS) {
                matches.add(new Match(entry.getKey(), distinct.size(), occurrences));
            }
        }
        return matches.stream()
                .sorted((a, b) -> a.distinctKeywords() != b.distinctKeywords()
                        ? Integer.compare(b.distinctKeywords(), a.distinctKeywords())
                        : Integer.compare(b.occurrences(), a.occurrences()))
                .limit(MAX_TAGS)
                .map(Match::tag)
                .toList();
    }

    static int countOccurrences(String haystack, String needle) {
        if (needle.isEmpty()) {
            return 0;
        }
        int count = 0;
        int index = 0;
        while ((index = haystack.indexOf(needle, index)) >= 0) {
            count++;
            index += needle.length();
        }
        return count;
    }
}

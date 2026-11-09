package com.kb.weekly;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 周报笔记正文（纯函数，便于单测）：<b>两列信息表 + 三句短评</b>，中文、适合扫读。
 *
 * <p>硬规则：<b>没有的字段整行/整段省略</b>，绝不写「未知」占位，也不编造数据。
 */
public final class WeeklyNoteContent {

    /** 一句话价值上限。 */
    public static final int VALUE_LIMIT = 80;
    /** 推荐理由上限。 */
    public static final int REASON_LIMIT = 60;

    static final String LANGUAGE_DISCLAIMER = "按语言推断，仅供参考";

    private static final DateTimeFormatter MONTH_DAY = DateTimeFormatter.ofPattern("MM-dd");

    private WeeklyNoteContent() {
    }

    /**
     * @param descriptionZh 已翻译的一句话价值（中文）；为空则整段省略
     * @param rank 在本源榜单里的名次（从 1 开始）
     */
    public static String render(WeeklyRepo repo, String isoWeek, String descriptionZh, int rank) {
        StringBuilder out = new StringBuilder();
        out.append("# [").append(repo.sourceLabel()).append("] ").append(repo.repo()).append("\n\n");

        Map<String, String> rows = tableRows(repo, rank);
        if (!rows.isEmpty()) {
            out.append("| 项目信息 | |\n|---|---|\n");
            rows.forEach((key, value) -> out.append("| ").append(key).append(" | ").append(value)
                    .append(" |\n"));
            out.append('\n');
        }

        String value = oneLiner(descriptionZh);
        if (value != null) {
            out.append("**一句话价值**：").append(value).append("\n\n");
        }
        out.append("**推荐理由**：").append(reason(repo, rank)).append("\n\n");
        String audience = audience(repo.language());
        if (audience != null) {
            out.append("**适用人群**：").append(audience).append("（**").append(LANGUAGE_DISCLAIMER)
                    .append("**）。\n");
        }
        return out.toString();
    }

    /** 信息表格：只放有值的行（顺序固定，便于扫读）。 */
    static Map<String, String> tableRows(WeeklyRepo repo, int rank) {
        Map<String, String> rows = new LinkedHashMap<>();
        if (repo.weeklyStars() != null) {
            rows.put("本周新增", "**+" + format(repo.weeklyStars()) + "** ⭐");
        }
        if (repo.stars() > 0) {
            rows.put("总星", compact(repo.stars()));
        }
        if (repo.language() != null && !repo.language().isBlank()) {
            rows.put("语言", repo.language().trim());
        }
        String updated = monthDay(repo.updatedAt());
        if (updated != null) {
            rows.put("最近更新", updated);
        }
        rows.put("本周榜位", "第 " + rank + " 名");
        if (repo.url() != null && !repo.url().isBlank()) {
            rows.put("仓库地址", repo.url().trim());
        }
        return rows;
    }

    /** 一句话价值：截断到 80 字以内，只留一句；没有描述就整段省略。 */
    static String oneLiner(String descriptionZh) {
        if (descriptionZh == null || descriptionZh.isBlank()) {
            return null;
        }
        String text = descriptionZh.trim().replaceAll("\\s+", " ");
        int sentenceEnd = firstSentenceEnd(text);
        if (sentenceEnd > 0 && sentenceEnd <= VALUE_LIMIT) {
            text = text.substring(0, sentenceEnd);
        }
        return truncate(text, VALUE_LIMIT);
    }

    /** 推荐理由：周增 + 榜位 + 语言压成一句，≤60 字。 */
    static String reason(WeeklyRepo repo, int rank) {
        String language = repo.language() == null ? "" : repo.language().trim();
        String text;
        if (repo.weeklyStars() != null) {
            text = "本周新增 " + format(repo.weeklyStars()) + " 颗星，位列 " + repo.sourceLabel()
                    + " 周榜第 " + rank + (language.isEmpty() ? "。" : "；" + language + " 技术栈，评估成本低。");
        } else {
            text = "首次收录，" + repo.sourceLabel() + " 推荐榜第 " + rank + "，下周起显示真实周增。";
        }
        return truncate(text, REASON_LIMIT);
    }

    /** 语言 → 技术栈人群；无映射返回 null（整行省略）。 */
    static String audience(String language) {
        if (language == null || language.isBlank()) {
            return null;
        }
        return switch (language.trim().toLowerCase(Locale.ROOT)) {
            case "java" -> "Java 开发者";
            case "javascript", "typescript" -> "前端与工具链开发者";
            case "python" -> "Python 开发者";
            case "go" -> "Go 开发者";
            case "rust" -> "Rust 开发者";
            default -> null;
        };
    }

    /** 最近更新时间 → {@code MM-dd}；空/不可解析返回 null（整行省略）。 */
    static String monthDay(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String text = raw.trim();
        try {
            return OffsetDateTime.parse(text).format(MONTH_DAY);
        } catch (RuntimeException ignored) {
            // 继续
        }
        try {
            return Instant.parse(text).atOffset(java.time.ZoneOffset.UTC).format(MONTH_DAY);
        } catch (RuntimeException ignored) {
            // 继续
        }
        try {
            return LocalDate.parse(text).format(MONTH_DAY);
        } catch (RuntimeException ignored) {
            // 继续
        }
        try {
            return LocalDateTime.parse(text).format(MONTH_DAY);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    /** 12680 → 12,680 */
    static String format(long value) {
        return String.format(Locale.ROOT, "%,d", value);
    }

    /** 12680 → 12.7k（≥1000 用 k，保留一位小数） */
    static String compact(long stars) {
        if (stars < 1000) {
            return String.valueOf(stars);
        }
        String text = String.format(Locale.ROOT, "%.1fk", stars / 1000.0);
        return text.replace(".0k", "k");
    }

    private static int firstSentenceEnd(String text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '。' || c == '！' || c == '？') {
                return i + 1;
            }
            if (c == '.' && (i + 1 == text.length() || Character.isWhitespace(text.charAt(i + 1)))) {
                return i + 1;
            }
        }
        return -1;
    }

    private static String truncate(String text, int maxCodePoints) {
        if (text.codePointCount(0, text.length()) <= maxCodePoints) {
            return text;
        }
        return text.substring(0, text.offsetByCodePoints(0, maxCodePoints - 1)) + "…";
    }
}

package com.kb.archive;

import java.time.LocalDate;
import java.time.temporal.WeekFields;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * ISO 周目录名（{@code 2026-W43}）与日期互转。纯函数。
 *
 * <p>注意跨年：{@code 2026-W01} 的那一周从 <b>2025-12-29</b>（周一）开始，
 * 所以「按周比较」必须换算成该周的周一日期，不能只比较字符串/年份。
 */
public final class ArchiveWeek {

    private static final Pattern NAME = Pattern.compile("^(\\d{4})-W(\\d{2})$");

    private ArchiveWeek() {
    }

    /** @return 该 ISO 周周一的日期；名字不合规或周序号非法时为空 */
    public static Optional<LocalDate> startOfWeek(String folderName) {
        if (folderName == null) {
            return Optional.empty();
        }
        Matcher matcher = NAME.matcher(folderName.trim());
        if (!matcher.matches()) {
            return Optional.empty();
        }
        int year = Integer.parseInt(matcher.group(1));
        int week = Integer.parseInt(matcher.group(2));
        try {
            // 1 月 4 日永远落在第 1 周；据此反推该周周一，天然处理跨年
            LocalDate weekOne = LocalDate.of(year, 1, 4)
                    .with(WeekFields.ISO.dayOfWeek(), 1);
            return Optional.of(weekOne.plusWeeks(week - 1L));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    /** 日期所在 ISO 周的名字，形如 {@code 2026-W43}。 */
    public static String format(LocalDate date) {
        int week = date.get(WeekFields.ISO.weekOfWeekBasedYear());
        int year = date.get(WeekFields.ISO.weekBasedYear());
        return String.format(Locale.ROOT, "%d-W%02d", year, week);
    }

    /** 该周名字是否早于 cutoff（严格早于；同一周不归档）。 */
    public static boolean isOlderThan(String folderName, LocalDate cutoffWeekStart) {
        return startOfWeek(folderName)
                .map(start -> start.isBefore(cutoffWeekStart))
                .orElse(false);
    }
}

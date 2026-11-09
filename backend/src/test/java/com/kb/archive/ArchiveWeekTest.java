package com.kb.archive;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** ISO 周目录名与日期互转，重点是跨年边界。 */
class ArchiveWeekTest {

    @Test
    @DisplayName("跨年：2026-W01 的那一周从 2025-12-29（周一）开始")
    void firstWeekCrossesYear() {
        assertEquals(Optional.of(LocalDate.of(2025, 12, 29)), ArchiveWeek.startOfWeek("2026-W01"));
        // 反过来：2025-12-29 属于 2026 年第 1 周，不是 2025 年最后一周
        assertEquals("2026-W01", ArchiveWeek.format(LocalDate.of(2025, 12, 29)));
        assertEquals("2025-W52", ArchiveWeek.format(LocalDate.of(2025, 12, 28)));
    }

    @Test
    @DisplayName("普通周：2026-W43 → 2026-10-19；格式化回来一致")
    void parsesRegularWeek() {
        assertEquals(Optional.of(LocalDate.of(2026, 10, 19)), ArchiveWeek.startOfWeek("2026-W43"));
        assertEquals("2026-W43", ArchiveWeek.format(LocalDate.of(2026, 10, 25)));
        assertEquals("2026-W44", ArchiveWeek.format(LocalDate.of(2026, 10, 27)));
    }

    @Test
    @DisplayName("非法名字不算旧（不能误搬）")
    void rejectsInvalidNames() {
        assertTrue(ArchiveWeek.startOfWeek("归档").isEmpty());
        assertTrue(ArchiveWeek.startOfWeek("2026-43").isEmpty());
        assertTrue(ArchiveWeek.startOfWeek(null).isEmpty());
        assertFalse(ArchiveWeek.isOlderThan("归档", LocalDate.of(2026, 1, 1)));
        assertFalse(ArchiveWeek.isOlderThan("2026-Wxx", LocalDate.of(2026, 1, 1)));
    }

    @Test
    @DisplayName("isOlderThan 用周一的日期比较：同一周不搬")
    void comparesByWeekStart() {
        LocalDate cutoff = LocalDate.of(2026, 9, 7);          // 2026-W37 周一
        assertTrue(ArchiveWeek.isOlderThan("2026-W36", cutoff));
        assertFalse(ArchiveWeek.isOlderThan("2026-W37", cutoff), "同一周不能算旧");
        assertFalse(ArchiveWeek.isOlderThan("2026-W38", cutoff));
        // 跨年场景：cutoff 在 2026 年，2025 年的周一定更旧
        assertTrue(ArchiveWeek.isOlderThan("2025-W52", LocalDate.of(2026, 1, 5)));
    }
}

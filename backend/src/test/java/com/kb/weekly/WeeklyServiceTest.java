package com.kb.weekly;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** ISO 周计算与 status 判定（纯函数）。 */
class WeeklyServiceTest {

    @Test
    @DisplayName("ISO 周字符串形如 2026-W44，跨年按 week-based-year")
    void computesIsoWeek() {
        assertEquals("2026-W44", WeeklyService.currentIsoWeek(Instant.parse("2026-10-30T10:00:00Z")));
        // 2027-01-01 是周五，属于 ISO 2026-W53（跨年但按 week-based-year 算）
        assertEquals("2026-W53", WeeklyService.currentIsoWeek(Instant.parse("2027-01-01T10:00:00Z")));
    }

    @Test
    @DisplayName("两边都有 → success；只有一边 → partial；都没有 → failed")
    void decidesStatus() {
        WeeklyRepo repo = new WeeklyRepo("github", "a/b", "https://github.com/a/b", 1L, 2, null, null);
        assertEquals("success", WeeklyService.decideStatus(List.of(repo), List.of(repo)));
        assertEquals("partial", WeeklyService.decideStatus(List.of(repo), List.of()));
        assertEquals("partial", WeeklyService.decideStatus(List.of(), List.of(repo)));
        assertEquals("failed", WeeklyService.decideStatus(List.of(), List.of()));
    }
}

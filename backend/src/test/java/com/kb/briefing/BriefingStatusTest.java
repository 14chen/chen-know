package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** status 判定：0 失败 / 1 失败（≤10% 抖动容忍）成功 / 多失败 partial / 全失败 failed。 */
class BriefingStatusTest {

    private static final int TEN = 10;

    @Test
    @DisplayName("全部成功 → success")
    void allSucceed() {
        assertEquals("success", BriefingService.decideStatus(TEN, 0));
        assertEquals("success", BriefingService.decideStatus(1, 0));
    }

    @Test
    @DisplayName("10 个源里 1 个抖动 → 仍 success（失败照旧写进正文）")
    void singleBlipIsStillSuccess() {
        assertEquals("success", BriefingService.decideStatus(TEN, 1));
        assertEquals("success", BriefingService.decideStatus(9, 1));
        // 注意：attempted=1、failed=1 属于「全部源失败」，按规格应是 failed（见 allFailMakeFailed）
    }

    @Test
    @DisplayName("失败超过 10% → partial")
    void moreFailuresMakePartial() {
        assertEquals("partial", BriefingService.decideStatus(TEN, 2));
        assertEquals("partial", BriefingService.decideStatus(TEN, 5));
        assertEquals("partial", BriefingService.decideStatus(9, 2));
    }

    @Test
    @DisplayName("全部失败 → failed")
    void allFailMakeFailed() {
        assertEquals("failed", BriefingService.decideStatus(TEN, TEN));
        assertEquals("failed", BriefingService.decideStatus(3, 3));
    }

    @Test
    @DisplayName("没有可跑的源（全被跳过）→ success")
    void nothingAttemptedIsSuccess() {
        assertEquals("success", BriefingService.decideStatus(0, 0));
    }
}

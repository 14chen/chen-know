package com.kb.activity;

import java.util.List;

/** API.md §9 GET /api/stats 响应体。 */
public record StatsResponse(
        long noteCount,
        long folderCount,
        long tagCount,
        long attachmentCount,
        long totalAttachmentBytes,
        long trashCount,
        long updatedToday,
        List<DailyCreated> dailyCreated) {

    /** {@code dailyCreated} 的元素：固定最近 14 天（含今天），无数据补 0。 */
    public record DailyCreated(String date, long count) {
    }
}

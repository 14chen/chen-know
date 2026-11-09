package com.kb.briefing;

import java.util.List;

/** BRIEFING.md §6：{@code GET /api/briefing/runs} 的条目。 */
public record BriefingRunView(long id, String startedAt, String finishedAt, String status, int totalItems,
        int newItems, Long noteId, List<SourceReportEntry> sourceReport) {
}

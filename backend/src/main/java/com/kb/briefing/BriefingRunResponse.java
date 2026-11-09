package com.kb.briefing;

import java.util.List;

/** BRIEFING.md §6：{@code POST /api/briefing/run} 的响应。 */
public record BriefingRunResponse(long runId, String status, int totalItems, int newItems, Long noteId,
        List<SourceReportEntry> sourceReport) {
}

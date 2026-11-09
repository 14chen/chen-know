package com.kb.briefing;

/** {@code briefing_runs} 的一行（BRIEFING.md §2）。 */
public record BriefingRun(long id, long spaceId, String startedAt, String finishedAt, String status,
        Long noteId, int totalItems, int newItems, String sourceReport, String error) {
}

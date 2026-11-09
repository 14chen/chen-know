package com.kb.briefing;

import java.util.List;

/** BRIEFING.md §6：运行历史（数量天然有界，用裸 {@code {items}}）。 */
public record BriefingRunsResponse(List<BriefingRunView> items) {
}

package com.kb.briefing;

/** BRIEFING.md §6：源状态表条目。{@code skipped=true} 的源仍列出来，但标注为已知不可达。 */
public record BriefingSourceView(String id, String name, String url, String kind, boolean skipped, String note) {

    static BriefingSourceView of(BriefingSource source, boolean skipped, String note) {
        return new BriefingSourceView(source.id(), source.name(), source.url(), source.kind(), skipped, note);
    }
}

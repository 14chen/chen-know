package com.kb.briefing;

/**
 * BRIEFING.md §2：{@code source_report} 数组的元素。
 *
 * <p>{@code skipped=true} 表示这个源配置为「已知不可达（反爬）」被跳过：没发请求、不计入失败，
 * 也不影响整次运行的 status。
 */
public record SourceReportEntry(String source, boolean ok, int count, String error, boolean skipped) {

    public SourceReportEntry(String source, boolean ok, int count, String error) {
        this(source, ok, count, error, false);
    }
}

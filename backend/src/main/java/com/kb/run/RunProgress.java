package com.kb.run;

/** run 的分阶段进度；stageLabel 给前端直接展示。 */
public record RunProgress(long runId, String status, String stage, int done, int total, boolean cancelled,
        String startedAt, String finishedAt, String stageLabel) {

    /** 作为 record 组件输出，Jackson 才会序列化；方法形式不会被序列化。 */
    public static String labelFor(String stage) {
        return switch (stage == null ? "" : stage) {
            case "fetching" -> "正在抓取各源";
            case "enriching" -> "正在翻译与补充正文";
            case "quality_ai" -> "正在评分与分析";
            case "rendering" -> "正在生成笔记";
            case "done" -> "已完成";
            case "failed" -> "生成失败";
            case "cancelled" -> "已取消";
            default -> "准备中";
        };
    }
}

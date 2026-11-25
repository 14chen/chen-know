package com.kb.quality;

import java.util.List;

/** GET /api/quality/report 的响应契约，字段一律 camelCase。 */
public record QualityReportResponse(String module, int scanned, int downgraded, int averageScore,
        List<ReasonCount> reasons, List<Sample> samples) {

    public record ReasonCount(String reason, int count) {
    }

    public record Sample(String targetKey, int score, List<String> reasons) {
    }
}

package com.kb.quality;

import com.kb.common.ApiException;
import com.kb.common.Times;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** 只读报告：扫描已有缓存并评分，落结果表；不改写任何历史笔记。 */
@Service
public class QualityReportService {

    private final QualityReportRepository repository;
    private final QualityGate gate;

    public QualityReportService(QualityReportRepository repository, QualityGate gate) {
        this.repository = repository;
        this.gate = gate;
    }

    public QualityReportResponse report(long spaceId, String module, int limit) {
        if (!"briefing".equals(module)) {
            throw ApiException.validation("module 目前只支持 briefing", "module");
        }
        List<QualityReportRepository.Row> rows = repository.briefingRows(spaceId, limit);
        String now = Times.format(Instant.now());
        Map<String, Integer> reasonCounts = new LinkedHashMap<>();
        List<QualityReportResponse.Sample> samples = new ArrayList<>();
        int total = 0;
        int downgraded = 0;
        List<String> priors = new ArrayList<>();

        for (QualityReportRepository.Row row : rows) {
            QualityResult result = gate.evaluate(new QualityInput(row.title(), row.summary(), List.copyOf(priors)));
            priors.add(row.summary() == null ? "" : row.summary());
            repository.save(spaceId, module, row.url(), result, now);
            total += result.score();
            if (!result.accepted()) {
                downgraded++;
                if (samples.size() < 5) {
                    samples.add(new QualityReportResponse.Sample(row.url(), result.score(), result.reasons()));
                }
            }
            for (String reason : result.reasons()) {
                reasonCounts.merge(reason, 1, Integer::sum);
            }
        }
        List<QualityReportResponse.ReasonCount> reasons = reasonCounts.entrySet().stream()
                .map(e -> new QualityReportResponse.ReasonCount(e.getKey(), e.getValue()))
                .sorted(Comparator.comparingInt(QualityReportResponse.ReasonCount::count).reversed())
                .toList();
        return new QualityReportResponse(module, rows.size(), downgraded,
                rows.isEmpty() ? 0 : total / rows.size(), reasons, samples);
    }
}

package com.kb.analysis;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 分析结果缓存：内容哈希不一致或过期时按未命中处理。 */
@Repository
public class AnalysisCache {

    private final JdbcTemplate jdbc;

    public AnalysisCache(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<AnalysisResult> find(long spaceId, String module, String targetKey, String contentHash,
            String refreshedAfterIso) {
        return jdbc.query("SELECT payload_json FROM ai_analysis WHERE space_id = ? AND module = ?"
                        + " AND target_key = ? AND content_hash = ? AND created_at >= ?",
                (rs, n) -> rs.getString("payload_json"), spaceId, module, targetKey, contentHash, refreshedAfterIso)
                .stream().findFirst().flatMap(AnalysisResult::parse);
    }

    public void save(long spaceId, String module, String targetKey, String contentHash, String provider,
            String model, AnalysisResult result, String now) {
        jdbc.update("INSERT INTO ai_analysis (space_id, module, target_key, content_hash, provider, model,"
                        + " payload_json, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                        + " ON CONFLICT(space_id, module, target_key) DO UPDATE SET content_hash = excluded.content_hash,"
                        + " provider = excluded.provider, model = excluded.model,"
                        + " payload_json = excluded.payload_json, confidence = excluded.confidence,"
                        + " created_at = excluded.created_at",
                spaceId, module, targetKey, contentHash, provider, model, result.toJson(), result.confidence(), now);
    }
}

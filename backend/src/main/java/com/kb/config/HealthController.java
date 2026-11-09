package com.kb.config;

import com.kb.common.Times;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** API.md §11：健康检查，无需登录；{@code db} 必须是真实探测结果。 */
@RestController
public class HealthController {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);

    private final JdbcTemplate jdbcTemplate;
    private final String version;

    public HealthController(JdbcTemplate jdbcTemplate, @Value("${kb.version:1.0.0}") String version) {
        this.jdbcTemplate = jdbcTemplate;
        this.version = version;
    }

    @GetMapping("/api/health")
    public Map<String, Object> health() {
        boolean databaseReachable;
        try {
            databaseReachable = jdbcTemplate.queryForObject("SELECT 1", Integer.class) != null;
        } catch (RuntimeException e) {
            log.warn("健康检查探测数据库失败: {}", e.getMessage());
            databaseReachable = false;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", databaseReachable ? "ok" : "degraded");
        body.put("version", version);
        body.put("time", Times.now());
        body.put("db", databaseReachable ? "ok" : "error");
        return body;
    }
}

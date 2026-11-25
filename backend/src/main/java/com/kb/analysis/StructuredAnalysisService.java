package com.kb.analysis;

import com.kb.common.Times;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** 编排：缓存 → 调用 → 校验 → 落缓存。失败与超预算都只返回 empty，不影响生成。 */
@Service
public class StructuredAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(StructuredAnalysisService.class);

    private final AnalysisProperties properties;
    private final AnalysisClient client;
    private final AnalysisCache cache;
    private final AtomicInteger used = new AtomicInteger();
    private volatile AnalysisUsage usage = AnalysisUsage.EMPTY;

    public StructuredAnalysisService(AnalysisProperties properties, AnalysisClient client, AnalysisCache cache) {
        this.properties = properties;
        this.client = client;
        this.cache = cache;
    }

    /** 每次简报/周报运行开始时调用，重置成本预算计数。 */
    public void beginRun() {
        used.set(0);
        usage = AnalysisUsage.EMPTY;
    }

    /** 当前 run 累计的 AI 用量（未配置 AI 时为 EMPTY）。 */
    public AnalysisUsage usage() {
        return usage;
    }

    public Optional<AnalysisResult> analyze(long spaceId, String module, String targetKey,
            AnalysisRequest request) {
        if (!properties.isEnabled() || "none".equals(properties.getProvider())) {
            return Optional.empty();
        }
        if (used.get() >= properties.getMaxItemsPerRun()) {
            return Optional.empty();
        }
        String hash = hash(request);
        String cutoff = Times.format(Instant.now().minus(Duration.ofDays(properties.getCacheTtlDays())));
        Optional<AnalysisResult> cached = cache.find(spaceId, module, targetKey, hash, cutoff);
        if (cached.isPresent()) {
            return cached;
        }
        Optional<AnalysisResult> result;
        try {
            result = client.analyze(request);
            usage = usage.add(client.lastUsage());
        } catch (RuntimeException e) {
            log.warn("AI 分析客户端异常，跳过本条: {}", e.getClass().getSimpleName());
            return Optional.empty();
        }
        if (result.isEmpty()) {
            return Optional.empty();   // 失败不写缓存，下一轮仍可重试
        }
        used.incrementAndGet();
        cache.save(spaceId, module, targetKey, hash, client.providerName(), properties.getModel(),
                result.get(), Times.format(Instant.now()));
        return result;
    }

    private static String hash(AnalysisRequest request) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(((request.title() == null ? "" : request.title()) + "\n"
                    + (request.summary() == null ? "" : request.summary()))
                    .getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(bytes);
        } catch (NoSuchAlgorithmException e) {
            return String.valueOf((request.title() + request.summary()).hashCode());
        }
    }
}

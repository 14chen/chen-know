package com.kb.user;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * 登录失败限流（API.md §1 安全要求）：同一用户名连续失败 {@value #MAX_FAILURES} 次 → 锁定
 * {@value #LOCK_MINUTES} 分钟，期间返回 429。
 *
 * <p>按「提交的用户名」计数（无论该账号是否存在），因此也顺带抑制用户名枚举。
 * 状态存内存：单实例部署够用，重启即清零。
 */
@Component
public class LoginAttemptService {

    static final int MAX_FAILURES = 5;
    static final long LOCK_MINUTES = 15;
    private static final Duration LOCK_DURATION = Duration.ofMinutes(LOCK_MINUTES);
    private static final Duration STALE_AFTER = Duration.ofHours(1);
    private static final int SWEEP_THRESHOLD = 512;

    private final Map<String, Attempt> attempts = new ConcurrentHashMap<>();

    private record Attempt(int failures, Instant lockedUntil, Instant lastFailureAt) {
    }

    public boolean isLocked(String username) {
        Attempt attempt = attempts.get(key(username));
        return attempt != null && attempt.lockedUntil() != null
                && attempt.lockedUntil().isAfter(Instant.now());
    }

    public long remainingLockSeconds(String username) {
        Attempt attempt = attempts.get(key(username));
        if (attempt == null || attempt.lockedUntil() == null) {
            return 0;
        }
        long seconds = Duration.between(Instant.now(), attempt.lockedUntil()).toSeconds();
        return Math.max(0, seconds);
    }

    public void recordFailure(String username) {
        Instant now = Instant.now();
        attempts.compute(key(username), (k, current) -> {
            if (current != null && current.lockedUntil() != null && current.lockedUntil().isAfter(now)) {
                return current;
            }
            int failures = (current == null ? 0 : current.failures()) + 1;
            if (failures >= MAX_FAILURES) {
                return new Attempt(failures, now.plus(LOCK_DURATION), now);
            }
            return new Attempt(failures, null, now);
        });
        if (attempts.size() > SWEEP_THRESHOLD) {
            sweep(now);
        }
    }

    public void recordSuccess(String username) {
        attempts.remove(key(username));
    }

    private void sweep(Instant now) {
        attempts.entrySet().removeIf(entry -> {
            Attempt attempt = entry.getValue();
            if (attempt.lockedUntil() != null) {
                return attempt.lockedUntil().isBefore(now);
            }
            return attempt.lastFailureAt().isBefore(now.minus(STALE_AFTER));
        });
    }

    private static String key(String username) {
        return username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
    }
}

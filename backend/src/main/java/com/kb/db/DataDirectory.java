package com.kb.db;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 解析数据目录。契约：数据库固定为 <仓库根>/data/kb.db。
 *
 * <p>运行目录可能是 {@code backend/}（mvnw 启动）也可能是仓库根（java -jar），
 * 因此默认策略是：从运行目录向上找到第一个同时含 {@code docs/} 与 {@code docs/SCHEMA.md}
 * 的祖先目录作为仓库根；找不到则退回运行目录。配置项 {@code kb.data-dir} 可显式覆盖。
 */
public final class DataDirectory {

    private static final String[] ROOT_MARKERS = {"docs/SCHEMA.md"};

    private DataDirectory() {
    }

    /** @param configured {@code kb.data-dir} 的值，空白表示自动定位 */
    public static Path resolve(String configured, Path workingDirectory) throws IOException {
        Path base = workingDirectory.toAbsolutePath().normalize();
        if (configured != null && !configured.isBlank()) {
            Path configuredPath = Path.of(configured.trim());
            Path dir = configuredPath.isAbsolute() ? configuredPath : base.resolve(configuredPath);
            return ensureExists(dir.normalize());
        }
        for (Path candidate = base; candidate != null; candidate = candidate.getParent()) {
            if (isRepoRoot(candidate)) {
                return ensureExists(candidate.resolve("data"));
            }
        }
        return ensureExists(base.resolve("data"));
    }

    private static boolean isRepoRoot(Path dir) {
        for (String marker : ROOT_MARKERS) {
            if (!Files.isRegularFile(dir.resolve(marker))) {
                return false;
            }
        }
        return true;
    }

    private static Path ensureExists(Path dir) throws IOException {
        Files.createDirectories(dir);
        return dir;
    }
}

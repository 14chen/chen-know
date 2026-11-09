package com.kb.weekly;

import com.kb.briefing.BriefingText;
import com.kb.briefing.MiniJson;
import com.kb.db.DataDirectory;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Gitee 周榜：后端<b>不自己抓</b>（Nox JS 挑战，普通 HTTP 一律 405），
 * 只读浏览器脚本产出的 JSON（tools/weekly/fetch-gitee.mjs → data/weekly-gitee.json）。
 *
 * <p>路径解析（与 kb.weekly.gitee-json 的注释一致）：
 * <ol>
 *   <li>绝对路径 → 原样用</li>
 *   <li>相对路径 → 先按 <b>kb.data-dir 的父目录</b>（通常就是仓库根）解析</li>
 *   <li>那里没有 → 再退回按进程 cwd 解析（兼容旧用法）</li>
 *   <li>都没有 → 当作「Gitee 数据不可用」，走降级分支</li>
 * </ol>
 *
 * <p>文件不存在 / 过期（默认 8 天）/ 解析失败 → 返回 missing，由上层在笔记里如实写
 * 「本周 Gitee 数据未更新」，绝不让整个任务失败。
 */
@Component
public class GiteeWeeklyReader {

    private static final Logger log = LoggerFactory.getLogger(GiteeWeeklyReader.class);

    /** 超过这个天数就认为数据过期。 */
    static final Duration MAX_AGE = Duration.ofDays(8);

    private final WeeklyProperties properties;
    private final String configuredDataDir;

    public GiteeWeeklyReader(WeeklyProperties properties,
            @Value("${kb.data-dir:}") String configuredDataDir) {
        this.properties = properties;
        this.configuredDataDir = configuredDataDir == null ? "" : configuredDataDir;
    }

    /** @param items 解析出的项目（按文件顺序，即榜单顺序） @param note 缺失/过期的原因（成功时为 null） */
    public record Result(List<WeeklyRepo> items, String note) {

        static Result missing(String note) {
            return new Result(List.of(), note);
        }
    }

    public Result read() {
        Path path = resolvePath();
        if (path == null) {
            return Result.missing("本周 Gitee 数据未更新（未找到 " + configuredGiteeJson() + "）");
        }
        String json;
        try {
            json = Files.readString(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.warn("读取 Gitee 数据文件失败: {}", e.toString());
            return Result.missing("本周 Gitee 数据未更新（读取失败）");
        }
        try {
            return parse(json, Instant.now());
        } catch (IllegalArgumentException e) {
            log.warn("解析 Gitee 数据文件失败: {}", e.toString());
            return Result.missing("本周 Gitee 数据未更新（格式无法解析）");
        }
    }

    /** @param now 用于判断新鲜度（单测传入固定时刻） */
    public Result parse(String json, Instant now) {
        Map<String, Object> root = MiniJson.asObject(MiniJson.parse(json));
        String fetchedAt = MiniJson.string(root.get("fetchedAt"));
        if (fetchedAt != null && !fetchedAt.isBlank()) {
            try {
                Instant when = Instant.parse(fetchedAt);
                if (Duration.between(when, now).compareTo(MAX_AGE) > 0) {
                    return Result.missing("本周 Gitee 数据未更新（脚本数据已超过 " + MAX_AGE.toDays() + " 天）");
                }
            } catch (DateTimeParseException e) {
                log.debug("Gitee 数据的 fetchedAt 无法解析，按最新处理: {}", fetchedAt);
            }
        }
        List<WeeklyRepo> items = new ArrayList<>();
        for (Object element : MiniJson.asArray(root.get("items"))) {
            Map<String, Object> item = MiniJson.asObject(element);
            String repo = MiniJson.string(item.get("repo"));
            Integer stars = MiniJson.integer(item.get("stars"));
            if (repo == null || !repo.contains("/")) {
                continue;
            }
            String description = BriefingText.collapse(BriefingText.stripHtml(
                    MiniJson.string(item.get("desc")) == null ? "" : MiniJson.string(item.get("desc"))));
            String updatedAt = MiniJson.string(item.get("updatedAt"));
            items.add(new WeeklyRepo("gitee", repo.trim(), giteeUrl(repo.trim()),
                    stars == null ? 0L : stars, null, null, description.isEmpty() ? null : description,
                    updatedAt == null || updatedAt.isBlank() ? null : updatedAt.trim()));
        }
        if (items.isEmpty()) {
            return Result.missing("本周 Gitee 数据未更新（文件里没有条目）");
        }
        return new Result(items, null);
    }

    /** Gitee 的中文 owner 要按路径段做百分号编码，否则链接打不开。 */
    static String giteeUrl(String repo) {
        String[] parts = repo.split("/", 2);
        StringBuilder url = new StringBuilder("https://gitee.com/");
        for (int index = 0; index < parts.length; index++) {
            if (index > 0) {
                url.append('/');
            }
            url.append(java.net.URLEncoder.encode(parts[index], StandardCharsets.UTF_8)
                    .replace("+", "%20"));
        }
        return url.toString();
    }

    /**
     * 解析 kb.weekly.gitee-json：绝对路径原样；相对路径优先「kb.data-dir 的父目录」，
     * 其次进程 cwd。返回 null 表示两处都不存在。
     */
    Path resolvePath() {
        String configured = configuredGiteeJson();
        Path raw = Path.of(configured);
        if (raw.isAbsolute()) {
            boolean exists = Files.exists(raw);
            log.info("Gitee 数据文件: {}（来源：配置的绝对路径{}）", raw.normalize(),
                    exists ? "" : "，但文件不存在");
            return exists ? raw.normalize() : null;
        }
        Path fromDataDir = repoRoot().resolve(raw).normalize();
        if (Files.exists(fromDataDir)) {
            log.info("Gitee 数据文件: {}（来源：data-dir 父目录）", fromDataDir);
            return fromDataDir;
        }
        Path fromCwd = Path.of(System.getProperty("user.dir")).resolve(raw).normalize();
        if (Files.exists(fromCwd)) {
            log.info("Gitee 数据文件: {}（来源：cwd）", fromCwd);
            return fromCwd;
        }
        log.info("Gitee 数据文件: {}（来源：data-dir 父目录 与 cwd 都没有）", fromDataDir);
        return null;
    }

    /** data-dir 的父目录（通常就是仓库根）；解析不出来时退回 cwd。 */
    Path repoRoot() {
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        try {
            Path dataDir = DataDirectory.resolve(configuredDataDir, cwd);
            Path parent = dataDir.getParent();
            return parent == null ? cwd : parent;
        } catch (IOException | RuntimeException e) {
            log.debug("解析 data-dir 失败，退回 cwd: {}", e.toString());
            return cwd;
        }
    }

    String configuredGiteeJson() {
        String configured = properties.getGiteeJson() == null ? "" : properties.getGiteeJson().trim();
        return configured.isEmpty() ? "data/weekly-gitee.json" : configured;
    }
}

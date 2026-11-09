package com.kb.weekly;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Gitee 数据文件解析：结构、中文 owner 编码、缺失/过期都只降级不抛。 */
class GiteeWeeklyReaderTest {

    private static final Instant NOW = Instant.parse("2026-10-30T10:00:00Z");

    private static GiteeWeeklyReader reader() {
        return new GiteeWeeklyReader(new WeeklyProperties(), "");
    }

    @Test
    @DisplayName("相对路径解析：优先 kb.data-dir 的父目录（仓库根），找不到就当不可用")
    void resolvesRelativePathFromDataDirParent() throws Exception {
        java.nio.file.Path root = java.nio.file.Files.createTempDirectory("kb-gh-weekly-");
        java.nio.file.Path dataDir = java.nio.file.Files.createDirectories(root.resolve("data"));
        java.nio.file.Files.writeString(dataDir.resolve("weekly-gitee.json"),
                "{\"fetchedAt\":\"2026-10-30T10:00:00Z\",\"items\":[{\"repo\":\"a/b\",\"stars\":1}]}",
                java.nio.charset.StandardCharsets.UTF_8);

        WeeklyProperties properties = new WeeklyProperties();
        GiteeWeeklyReader resolved = new GiteeWeeklyReader(properties, dataDir.toString());
        assertEquals(dataDir.resolve("weekly-gitee.json").normalize(), resolved.resolvePath(),
                "应该按 data-dir 父目录（仓库根）解析");

        // 文件不在 → 视为不可用（走降级）
        WeeklyProperties missingProps = new WeeklyProperties();
        missingProps.setGiteeJson("data/definitely-missing-" + System.nanoTime() + ".json");
        assertNull(new GiteeWeeklyReader(missingProps, dataDir.toString()).resolvePath());
    }

    private static String json(String fetchedAt) {
        return """
                {"fetchedAt":"%s","source":"https://gitee.com/explore/all","metric":"stars",
                 "items":[
                   {"repo":"dromara/Sa-Token","stars":49500,"desc":"轻量级 Java 权限认证框架","updatedAt":"2026-10-10"},
                   {"repo":"若依/RuoYi","stars":32000,"desc":"后台管理系统"},
                   {"repo":"bad-entry-without-slash","stars":1,"desc":"x"}
                 ]}
                """.formatted(fetchedAt);
    }

    @Test
    @DisplayName("解析条目 + 跳过非法 repo + 中文 owner 做百分号编码")
    void parsesAndEncodesUrl() {
        GiteeWeeklyReader.Result result = reader().parse(json("2026-10-29T10:00:00Z"), NOW);
        assertNull(result.note(), result.note());
        assertEquals(2, result.items().size(), result.items().toString());
        WeeklyRepo first = result.items().get(0);
        assertEquals("dromara/Sa-Token", first.repo());
        assertEquals(49500L, first.stars());
        assertEquals("gitee", first.source());
        assertEquals("https://gitee.com/dromara/Sa-Token", first.url());
        assertEquals("轻量级 Java 权限认证框架", first.description());
        assertEquals("2026-10-10", first.updatedAt(), "脚本给的 updatedAt 要透传");
        assertNull(result.items().get(1).updatedAt(), "没有 updatedAt 的项目保持 null");
        assertNull(first.weeklyStars(), "Gitee 的周增要等快照算，解析阶段必须是 null");

        WeeklyRepo chinese = result.items().get(1);
        assertEquals("若依/RuoYi", chinese.repo());
        assertEquals("https://gitee.com/%E8%8B%A5%E4%BE%9D/RuoYi", chinese.url(),
                "中文 owner 必须编码，否则链接打不开");
    }

    @Test
    @DisplayName("超过 8 天没更新 → 降级为「未更新」，条目为空")
    void staleDataIsSkipped() {
        GiteeWeeklyReader.Result result = reader().parse(json("2026-10-01T10:00:00Z"), NOW);
        assertTrue(result.items().isEmpty());
        assertNotNull(result.note());
        assertTrue(result.note().contains("未更新"), result.note());
    }

    @Test
    @DisplayName("文件不存在 → 降级说明；解析失败也降级")
    void missingFileDegrades() {
        WeeklyProperties properties = new WeeklyProperties();
        properties.setGiteeJson("data/definitely-not-there-" + System.nanoTime() + ".json");
        GiteeWeeklyReader.Result result = new GiteeWeeklyReader(properties, "").read();
        assertTrue(result.items().isEmpty());
        assertTrue(result.note().contains("未更新"), result.note());

        // 空 items
        GiteeWeeklyReader.Result empty = reader().parse(
                "{\"fetchedAt\":\"2026-10-29T10:00:00Z\",\"items\":[]}", NOW);
        assertTrue(empty.items().isEmpty());
        assertTrue(empty.note().contains("未更新"));
    }
}

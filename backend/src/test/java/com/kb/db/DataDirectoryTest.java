package com.kb.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DataDirectoryTest {

    @TempDir
    Path tempDir;

    private Path repoRoot() throws IOException {
        Path root = tempDir.resolve("知识库");
        Files.createDirectories(root.resolve("docs"));
        Files.writeString(root.resolve("docs").resolve("SCHEMA.md"), "# schema");
        Files.createDirectories(root.resolve("backend"));
        return root;
    }

    @Test
    @DisplayName("默认：从 backend/ 向上定位仓库根，数据库落在 <仓库根>/data")
    void resolvesRepoDataDirectoryFromBackend() throws IOException {
        Path root = repoRoot();
        Path resolved = DataDirectory.resolve(null, root.resolve("backend"));
        assertEquals(root.resolve("data").toAbsolutePath().normalize(), resolved);
        assertTrue(Files.isDirectory(resolved), "数据目录应被自动创建");
    }

    @Test
    @DisplayName("默认：在仓库根运行时同样指向 <仓库根>/data")
    void resolvesRepoDataDirectoryFromRoot() throws IOException {
        Path root = repoRoot();
        assertEquals(root.resolve("data").toAbsolutePath().normalize(), DataDirectory.resolve(null, root));
    }

    @Test
    @DisplayName("配置了 kb.data-dir 时以它为准，支持相对与绝对路径")
    void configuredDirectoryWins() throws IOException {
        Path root = repoRoot();
        // 相对路径按运行目录解析
        assertEquals(root.resolve("custom").toAbsolutePath().normalize(),
                DataDirectory.resolve("custom", root));
        Path absolute = tempDir.resolve("abs-data");
        assertEquals(absolute.toAbsolutePath().normalize(), DataDirectory.resolve(absolute.toString(), root));
    }

    @Test
    @DisplayName("不在仓库内时退回运行目录/data")
    void fallsBackToWorkingDirectory() throws IOException {
        Path lonely = tempDir.resolve("lonely");
        Files.createDirectories(lonely);
        assertEquals(lonely.resolve("data").toAbsolutePath().normalize(), DataDirectory.resolve(null, lonely));
    }
}

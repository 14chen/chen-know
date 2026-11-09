package com.kb;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** 上下文能否加载、schema 迁移能否在启动时执行（数据落在临时目录，不碰仓库 data/）。 */
@SpringBootTest
class KnowledgeBaseApplicationTests {

	private static final Path DATA_DIR = createDataDir();

	@DynamicPropertySource
	static void dataDirectory(DynamicPropertyRegistry registry) {
		registry.add("kb.data-dir", DATA_DIR::toString);
	}

	private static Path createDataDir() {
		try {
			return Files.createTempDirectory("kb-context-");
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	@Test
	void contextLoads() {
	}

}

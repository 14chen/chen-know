package com.kb.db;

import java.io.IOException;
import java.nio.file.Path;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DatabaseConfig {

    private static final Logger log = LoggerFactory.getLogger(DatabaseConfig.class);

    @Bean
    public DataSource dataSource(@Value("${kb.data-dir:}") String configuredDataDir) throws IOException {
        Path dataDir = DataDirectory.resolve(configuredDataDir, Path.of(System.getProperty("user.dir")));
        Path databaseFile = dataDir.resolve("kb.db");
        log.info("SQLite 数据库: {}", databaseFile.toAbsolutePath());
        // 生产路径走有界连接池（DEF-E3-006）；单测/临时库直接 new 时不池化，保证 close 真关句柄
        return new SqliteDataSource("jdbc:sqlite:" + databaseFile.toAbsolutePath(), true);
    }
}

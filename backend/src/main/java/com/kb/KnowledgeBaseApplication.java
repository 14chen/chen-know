package com.kb;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 排除 {@link UserDetailsServiceAutoConfiguration}：认证完全由 com.kb.user 自己实现，
 * 不需要 Boot 生成的 in-memory 用户（否则启动日志会打印一个随机密码，且留下一个多余的后门账号）。
 */
@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
@EnableScheduling
public class KnowledgeBaseApplication {

	public static void main(String[] args) {
		SpringApplication.run(KnowledgeBaseApplication.class, args);
	}

}
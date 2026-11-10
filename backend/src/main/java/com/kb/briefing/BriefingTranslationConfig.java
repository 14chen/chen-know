package com.kb.briefing;

import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 翻译 provider 的可插拔装配（{@code kb.briefing.translate-provider}）。
 *
 * <ul>
 *   <li>{@code auto}（默认）：配了 deepl-key 就用 DeepL，否则 MyMemory</li>
 *   <li>{@code deepl}：显式用 DeepL（没配 key 时 WARN 并回落到 MyMemory；运行中鉴权失败或额度
 *       耗尽时也会自动改用 MyMemory，不让简报整篇停在英文）</li>
 *   <li>{@code mymemory}：显式用 MyMemory</li>
 *   <li>{@code none}：完全不翻译，一律保留原文</li>
 * </ul>
 *
 * <p>启动时打一行 INFO 说明实际用的是哪个 provider（<b>不打印 key</b>）；带运行期回落时形如
 * {@code deepl(free)→mymemory}。
 */
@Configuration
public class BriefingTranslationConfig {

    private static final Logger log = LoggerFactory.getLogger(BriefingTranslationConfig.class);

    @Bean
    public TranslationClient briefingTranslationClient(BriefingProperties properties, HttpTransport transport) {
        TranslationClient client = choose(properties, transport);
        log.info("简报翻译 provider = {}（translate={}）", client.providerName(), properties.isTranslate());
        return client;
    }

    static TranslationClient choose(BriefingProperties properties, HttpTransport transport) {
        String provider = properties.getTranslateProvider() == null ? "auto"
                : properties.getTranslateProvider().trim().toLowerCase(Locale.ROOT);
        String key = properties.getDeeplKey() == null ? "" : properties.getDeeplKey().trim();
        if (provider.isEmpty()) {
            provider = "auto";
        }
        return switch (provider) {
            case "none" -> new NoopTranslationClient();
            case "mymemory" -> new MyMemoryTranslationClient(transport);
            case "deepl" -> {
                if (key.isEmpty()) {
                    log.warn("kb.briefing.translate-provider=deepl 但没配 deepl-key，回落到 MyMemory");
                    yield new MyMemoryTranslationClient(transport);
                }
                yield withRuntimeFallback(new DeepLTranslationClient(transport, key,
                        properties.getDeeplEndpoint()), transport);
            }
            default -> {
                if (!key.isEmpty()) {
                    yield withRuntimeFallback(new DeepLTranslationClient(transport, key,
                            properties.getDeeplEndpoint()), transport);
                }
                yield new MyMemoryTranslationClient(transport);
            }
        };
    }

    /** 主翻译失败时改用 MyMemory：DeepL key 失效是最常见的「整篇英文」成因。 */
    private static TranslationClient withRuntimeFallback(TranslationClient primary, HttpTransport transport) {
        return new FallbackTranslationClient(primary, new MyMemoryTranslationClient(transport));
    }
}

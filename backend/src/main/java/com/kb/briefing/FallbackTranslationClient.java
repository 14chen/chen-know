package com.kb.briefing;

import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 主翻译不可用时自动改用备用翻译的装饰器。
 *
 * <p>动机：DeepL 的 key 失效（403）或额度耗尽时，原来的实现只会把每一条都保留原文，
 * 整篇简报于是停在英文。这里把「翻译失败」从「这次没有翻译」降级成「换一家翻」。
 *
 * <p>规则：
 * <ul>
 *   <li>主翻译整体失败（鉴权/额度/网络全挂）→ 本次起直接走备用，不再重复等超时</li>
 *   <li>主翻译只成功了一部分（某些位置是 null）→ 只把失败的那几条交给备用补齐</li>
 *   <li>两家都失败 → 该位置仍是 null，调用方按契约保留原文</li>
 * </ul>
 */
public class FallbackTranslationClient implements TranslationClient {

    private static final Logger log = LoggerFactory.getLogger(FallbackTranslationClient.class);

    private final TranslationClient primary;
    private final TranslationClient fallback;
    private volatile boolean primaryDisabled;

    public FallbackTranslationClient(TranslationClient primary, TranslationClient fallback) {
        this.primary = primary;
        this.fallback = fallback;
    }

    @Override
    public String translate(String text) {
        if (!primaryDisabled) {
            try {
                return primary.translate(text);
            } catch (RuntimeException e) {
                disablePrimary(e);
            }
        }
        return fallback.translate(text);
    }

    @Override
    public List<String> translateAll(List<String> texts) {
        if (texts == null || texts.isEmpty()) {
            return List.of();
        }
        List<String> first = primaryDisabled ? null : translatePrimary(texts);
        if (first == null) {
            return translateWithFallback(texts);
        }
        List<Integer> missing = new ArrayList<>();
        for (int i = 0; i < texts.size(); i++) {
            String input = texts.get(i);
            String value = first.get(i);
            if ((value == null || value.isBlank()) && input != null && !input.isBlank()) {
                missing.add(i);
            }
        }
        if (missing.isEmpty()) {
            return first;
        }
        List<String> retry = new ArrayList<>(missing.size());
        for (int index : missing) {
            retry.add(texts.get(index));
        }
        List<String> second = translateWithFallback(retry);
        for (int i = 0; i < missing.size(); i++) {
            String value = second.get(i);
            if (value != null && !value.isBlank()) {
                first.set(missing.get(i), value);
            }
        }
        return first;
    }

    /** 备用翻译自己整体挂掉时不能把异常抛给调用方：按契约保留原文。 */
    private List<String> translateWithFallback(List<String> texts) {
        try {
            List<String> out = fallback.translateAll(texts);
            if (out != null && out.size() == texts.size()) {
                return out;
            }
            log.warn("备用翻译 {} 返回条数与入参不一致（{} / {}），保留原文",
                    fallback.providerName(), out == null ? "null" : out.size(), texts.size());
        } catch (RuntimeException e) {
            log.warn("备用翻译 {} 也不可用（{}），本次保留原文", fallback.providerName(), describe(e));
        }
        List<String> nulls = new ArrayList<>(texts.size());
        for (int i = 0; i < texts.size(); i++) {
            nulls.add(null);
        }
        return nulls;
    }

    private List<String> translatePrimary(List<String> texts) {
        try {
            List<String> out = primary.translateAll(texts);
            if (out != null && out.size() == texts.size()) {
                return new ArrayList<>(out);
            }
            log.warn("主翻译 {} 返回条数与入参不一致（{} / {}），视为不可用",
                    primary.providerName(), out == null ? "null" : out.size(), texts.size());
        } catch (RuntimeException e) {
            disablePrimary(e);
            return null;
        }
        primaryDisabled = true;
        return null;
    }

    private void disablePrimary(RuntimeException error) {
        if (!primaryDisabled) {
            primaryDisabled = true;
            log.warn("主翻译 {} 不可用（{}），本次起改用 {}（译文语言不变）",
                    primary.providerName(), describe(error), fallback.providerName());
        }
    }

    private static String describe(RuntimeException error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    @Override
    public String providerName() {
        return primary.providerName() + "→" + fallback.providerName();
    }
}

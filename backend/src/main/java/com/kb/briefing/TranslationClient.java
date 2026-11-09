package com.kb.briefing;

import java.util.ArrayList;
import java.util.List;

/**
 * 机器翻译的可插拔注入点（DeepL / MyMemory / 关闭）。
 *
 * <p>契约：实现必须<b>自己</b>把失败包装成 {@link BriefingFetchException}；
 * 调用方一律「失败就保留原文」，翻译永远不能让一次简报失败。
 */
public interface TranslationClient {

    /** 单条翻译；失败抛 {@link BriefingFetchException}。 */
    String translate(String text);

    /**
     * 批量翻译（DeepL 一次能翻 50 条，批量提交既省额度又快）。
     *
     * <p>返回列表与入参<b>一一对应</b>：某条失败对应位置是 {@code null}，
     * 只有整体不可用（鉴权失败/额度耗尽/网络全挂）时才允许抛异常。
     */
    default List<String> translateAll(List<String> texts) {
        List<String> out = new ArrayList<>(texts.size());
        for (String text : texts) {
            try {
                out.add(translate(text));
            } catch (RuntimeException e) {
                out.add(null);
            }
        }
        return out;
    }

    /** 供启动日志与失败信息使用（不要返回 key）。 */
    default String providerName() {
        return getClass().getSimpleName();
    }
}

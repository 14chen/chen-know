package com.kb.briefing;

import java.util.ArrayList;
import java.util.List;

/** 翻译关闭（{@code kb.briefing.translate-provider=none}）：一律保留原文。 */
public class NoopTranslationClient implements TranslationClient {

    @Override
    public String translate(String text) {
        throw new BriefingFetchException("翻译已关闭（translate-provider=none）");
    }

    @Override
    public List<String> translateAll(List<String> texts) {
        List<String> out = new ArrayList<>(texts.size());
        for (int index = 0; index < texts.size(); index++) {
            out.add(null);
        }
        return out;
    }

    @Override
    public String providerName() {
        return "none";
    }
}

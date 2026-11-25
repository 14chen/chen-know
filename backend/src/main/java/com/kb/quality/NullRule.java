package com.kb.quality;

/** 标题或摘要缺失：直接判死，这类内容在旧数据里大量存在（翻译失败仍被当成功缓存）。 */
public class NullRule implements QualityRule {

    @Override
    public String id() {
        return "missing_text";
    }

    @Override
    public int penalty(QualityInput input) {
        return input.title() == null || input.title().isBlank()
                || input.summary() == null || input.summary().isBlank() ? 100 : 0;
    }

    @Override
    public String reason() {
        return "标题或摘要为空（翻译失败不应写成成功）";
    }
}

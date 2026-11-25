package com.kb.quality;

/** 质量规则：纯函数，输入内容，输出扣分（0 = 通过）。不产生副作用，便于单测。 */
public interface QualityRule {

    String id();

    int penalty(QualityInput input);

    default String reason() {
        return id();
    }
}

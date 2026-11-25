package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 真实互动量信号（借 last30days 的思路）：热度权重与分档。
 * 只用原生数字（HN points / 评论数 / 跨源印证数），不引入主观源权重。
 */
class EngagementTest {

    @Test
    @DisplayName("热度权重：评论权重高于点赞，多源印证额外加分")
    void weightUsesRealSignals() {
        assertEquals(128, new Engagement(128, 0, 0).weight());
        assertEquals(72, new Engagement(0, 36, 0).weight(), "评论比点赞稀缺，权重 x2");
        assertEquals(200, new Engagement(128, 36, 0).weight());
        assertEquals(300, new Engagement(128, 36, 3).weight(), "第 2 个起每个印证源 +50");
    }

    @Test
    @DisplayName("分档：≥300 三档，≥100 二档，其余一档；无信号也是一档")
    void levels() {
        assertEquals(3, new Engagement(300, 0, 0).level());
        assertEquals(2, new Engagement(299, 0, 0).level());
        assertEquals(2, new Engagement(100, 0, 0).level());
        assertEquals(1, new Engagement(99, 0, 0).level());
        assertEquals(1, Engagement.NONE.level());
    }

    @Test
    @DisplayName("负数入参归零，避免脏数据把热度算成负分")
    void clampsNegatives() {
        Engagement e = new Engagement(-5, -10, -3);
        assertEquals(0, e.score());
        assertEquals(0, e.comments());
        assertEquals(0, e.corroboration());
        assertEquals(0, e.weight());
    }
}

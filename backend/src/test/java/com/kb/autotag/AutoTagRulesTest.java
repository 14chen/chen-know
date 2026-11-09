package com.kb.autotag;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 保守规则：≥2 个不同关键词才打、一篇最多 2 个、按命中排序。 */
class AutoTagRulesTest {

    @Test
    @DisplayName("命中 3 个后端关键词 → 打「后端」")
    void multiKeywordHitTags() {
        List<String> tags = AutoTagRules.suggest("接口设计",
                "这篇讲后端接口与 Spring 的事务边界，还有并发问题。");
        assertEquals(List.of("后端"), tags);
    }

    @Test
    @DisplayName("只命中 1 个关键词 → 不打（宁可少打）")
    void singleKeywordIsNotEnough() {
        assertTrue(AutoTagRules.suggest("随手记", "今天调了一下接口就下班了").isEmpty());
        assertTrue(AutoTagRules.suggest("", "").isEmpty());
    }

    @Test
    @DisplayName("多个领域都够格 → 最多 2 个，按命中关键词数排序")
    void atMostTwoTags() {
        List<String> tags = AutoTagRules.suggest("后端与数据库",
                "后端接口、Spring、并发；数据库索引、SQL 事务、迁移；另外还有 Docker 部署与监控。");
        assertEquals(2, tags.size(), tags.toString());
        assertTrue(tags.contains("后端") && tags.contains("数据库"), tags.toString());
    }

    @Test
    @DisplayName("中文与拉丁词都能命中，大小写不敏感")
    void matchesChineseAndLatin() {
        assertEquals(List.of("前端"), AutoTagRules.suggest("前端笔记",
                "React 组件与 Vue 页面样式，还有 CSS 变量。"));
        assertEquals(List.of("AI"), AutoTagRules.suggest("模型笔记",
                "大模型训练与推理，llm 的 prompt 设计。"));
    }
}

package com.kb.related;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 关键词抽取：汉字二元组、停用字过滤、AND 表达式（命中 ≥2 由查询本身保证）。 */
class RelatedKeywordsTest {

    @Test
    @DisplayName("汉字按二元组切，含虚词的组合被过滤")
    void extractsBigrams() {
        LinkedHashMap<String, Integer> counts = new LinkedHashMap<>();
        List<String> words = RelatedKeywords.bigrams("权限认证框架", counts);
        assertTrue(words.contains("权限"), words.toString());
        assertTrue(words.contains("认证"), words.toString());
        // 「的了」这种全是虚词的组合不该出现
        assertTrue(RelatedKeywords.bigrams("的了是在", new LinkedHashMap<>()).isEmpty());
    }

    @Test
    @DisplayName("高频词优先，最多 MAX_KEYWORDS 个")
    void keepsTopKeywords() {
        List<String> keywords = RelatedKeywords.from("权限",
                "权限权限权限 认证认证 框架 数据库 索引 事务 并发 部署 监控 日志");
        assertTrue(keywords.size() <= RelatedKeywords.MAX_KEYWORDS, keywords.toString());
        assertTrue(keywords.get(0).startsWith("权限") || keywords.contains("权限"), keywords.toString());
    }

    @Test
    @DisplayName("MATCH 表达式：取前两个词做 AND；可用词不足 2 个返回 null")
    void matchExpressionUsesAnd() {
        String expression = RelatedKeywords.matchExpression(List.of("权限", "认证", "框架"));
        assertNotNull(expression);
        assertTrue(expression.contains(" AND "), expression);
        assertNull(RelatedKeywords.matchExpression(List.of("权限")));
        assertNull(RelatedKeywords.matchExpression(List.of()));
    }

    @Test
    @DisplayName("空内容不抛异常")
    void handlesEmpty() {
        assertTrue(RelatedKeywords.from(null, null).isEmpty());
        assertTrue(RelatedKeywords.from("", "").isEmpty());
    }
}

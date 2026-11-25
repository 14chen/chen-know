package com.kb.quality;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/** 模板套话：清单来自 kb.quality.template-patterns，默认收录实测到的几句无效摘要。 */
public class BoilerplateRule implements QualityRule {

    private final List<Pattern> patterns = new ArrayList<>();

    public BoilerplateRule(List<String> expressions) {
        if (expressions != null) {
            for (String expression : expressions) {
                if (expression == null || expression.isBlank()) continue;
                try {
                    patterns.add(Pattern.compile(expression, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE));
                } catch (PatternSyntaxException e) {
                    // 配置里的坏正则不能让简报生成失败，跳过即可
                }
            }
        }
    }

    @Override
    public String id() {
        return "boilerplate";
    }

    @Override
    public int penalty(QualityInput input) {
        String text = input.normalized();
        if (text.isEmpty()) return 0;
        for (Pattern pattern : patterns) {
            if (pattern.matcher(text).find()) return 100;
        }
        return 0;
    }

    @Override
    public String reason() {
        return "命中模板套话（无信息量摘要）";
    }
}

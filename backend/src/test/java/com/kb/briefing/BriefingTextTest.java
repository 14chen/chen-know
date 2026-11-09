package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 文本工具：中文判定（决定是否翻译）、截断、去标签。 */
class BriefingTextTest {

    @Test
    @DisplayName("中文占比 > 30% 才算中文（英文标题不要跳过翻译）")
    void detectsChinese() {
        assertTrue(BriefingText.looksChinese("量子位报道：大模型推理成本再降"));
        assertTrue(BriefingText.looksChinese("机器之心：多模态新进展"));
        assertFalse(BriefingText.looksChinese("Google DeepMind announces Gemini 4 with improved reasoning"));
        assertFalse(BriefingText.looksChinese("OpenAI ships a new model"));
        assertFalse(BriefingText.looksChinese(""));
        assertFalse(BriefingText.looksChinese(null));
        assertTrue(BriefingText.looksChinese("大模型 GPT-5 发布，推理更强"));
    }

    @Test
    @DisplayName("截断按码点算，不切坏 emoji/中文")
    void truncatesByCodePoint() {
        String truncated = BriefingText.truncate("😀😀😀😀😀😀😀😀😀😀中文", 5);
        assertTrue(truncated.endsWith("…"), truncated);
        assertEquals(6, truncated.codePointCount(0, truncated.length()), "5 个码点 + 省略号");
    }

    @Test
    @DisplayName("去标签并把残留尖括号转义（简报正文不允许裸 HTML）")
    void stripsHtml() {
        assertEquals("a b", BriefingText.stripHtml("<p>a</p><b>b</b>"));
        assertFalse(BriefingText.stripHtml("<script>x</script> 1 < 2").contains("<"));
    }
}

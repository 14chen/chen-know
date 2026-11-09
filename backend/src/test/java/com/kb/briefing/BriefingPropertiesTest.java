package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalTime;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** BRIEFING.md §5 / 启动补抓：从 cron 推出「今天的生成时刻」。 */
class BriefingPropertiesTest {

    @Test
    @DisplayName("默认 cron（6 段，秒 分 时）= 18:30")
    void defaultCronMeans1830() {
        BriefingProperties properties = new BriefingProperties();
        assertEquals(LocalTime.of(18, 30), properties.dueTime());
    }

    @Test
    @DisplayName("自定义 6 段 cron：第 2/3 段是分与时（不是第 1/2 段）")
    void parsesSixFieldCron() {
        BriefingProperties properties = new BriefingProperties();
        properties.setCron("0 5 7 * * *");
        assertEquals(LocalTime.of(7, 5), properties.dueTime());
        properties.setCron("30 45 23 * * *");
        assertEquals(LocalTime.of(23, 45), properties.dueTime());
    }

    @Test
    @DisplayName("兼容 5 段 unix cron（分 时 …）")
    void parsesFiveFieldCron() {
        BriefingProperties properties = new BriefingProperties();
        properties.setCron("15 9 * * MON-FRI");
        assertEquals(LocalTime.of(9, 15), properties.dueTime());
    }

    @Test
    @DisplayName("skip-sources 默认只有 importai；大小写与空白不敏感")
    void skipSourcesDefault() {
        BriefingProperties properties = new BriefingProperties();
        assertEquals(List.of("importai"), properties.getSkipSources());
        assertTrue(properties.isSkipped("importai"));
        assertTrue(properties.isSkipped("  ImportAI "));
        assertFalse(properties.isSkipped("openai"));
        assertFalse(properties.isSkipped(null));
        properties.setSkipSources(List.of("importai", "huggingface"));
        assertTrue(properties.isSkipped("huggingface"));
    }

    @Test
    @DisplayName("非纯数字的段 → 回退到显式 hour/minute，再回退到 18:30")
    void fallsBackWhenCronIsNotLiteral() {
        BriefingProperties properties = new BriefingProperties();
        properties.setCron("0 */30 18 * * *");
        assertNull(BriefingProperties.parseSimpleClock(properties.getCron()));
        assertEquals(LocalTime.of(18, 30), properties.dueTime());

        properties.setHour(6);
        properties.setMinute(10);
        assertEquals(LocalTime.of(6, 10), properties.dueTime());
    }
}

package com.kb.briefing;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Set;

/**
 * BRIEFING.md §4：把抓取结果渲染成 Markdown。<b>纯函数</b>：无副作用、不读时钟，
 * 同样的输入永远产出同样的字节（便于单测与幂等）。
 *
 * <p>每条统一五段式（便于扫读）：
 * <pre>
 * #### 1. 中文标题
 * &gt; OpenAI · 10-25 · ★★★
 *
 * 一句话摘要（&gt;120 字截断）
 *
 * 原题：English Title
 * 链接：https://…
 * </pre>
 * 缺的字段整段省略，<b>绝不写「未知」占位</b>。
 */
public final class BriefingRenderer {

    /** 摘要上限：扫读用，超过就截断。 */
    public static final int SUMMARY_LIMIT = 120;

    private static final DateTimeFormatter MONTH_DAY = DateTimeFormatter.ofPattern("MM-dd");
    private static final Set<String> FIRST_HAND = Set.of("openai", "anthropic", "deepmind");
    /** HN 的重要级别分档。 */
    static final int HN_THREE_STAR = 300;
    static final int HN_TWO_STAR = 100;

    /** 末尾关于重要级别的小字说明。 */
    static final String IMPORTANCE_NOTE = "重要级别按来源类别与社区热度自动标注，仅供参考。";

    /**
     * 一条要收录的内容。
     *
     * @param title 展示标题（有译文时是中文）
     * @param score 只有 HN 这类源有，渲染成元信息里的「N 分」
     * @param originalTitle 原文标题（有译文时才有），渲染成「原题：…」一行
     * @param imageRef 配图引用，形如 {@code /api/attachments/12}（没有就是 null）
     * @param publishedAt 抓到的原始发布时间串（可能为空/不可解析 → 整段省略）
     */
    public record Item(String title, String url, String summary, Integer score, String originalTitle,
            String imageRef, String publishedAt) {

        public Item(String title, String url, String summary, Integer score, String originalTitle,
                String imageRef) {
            this(title, url, summary, score, originalTitle, imageRef, null);
        }

        public Item(String title, String url, String summary, Integer score) {
            this(title, url, summary, score, null, null, null);
        }
    }

    /** 一个源在本次简报里的产出。{@code sourceId} 用于重要级别判定（可空，兼容旧调用）。 */
    public record Block(String sourceName, String category, List<Item> items, String sourceId) {

        public Block(String sourceName, String category, List<Item> items) {
            this(sourceName, category, items, null);
        }
    }

    /**
     * 渲染输入。{@code alreadySeen} = 检查条数 - 新内容条数；
     * {@code skipped} 是「已知不可达（反爬）」被跳过的源，和「本次未取到」分开表达。
     */
    public record Document(String date, String generatedAt, int checked, int alreadySeen, int newItems,
            List<Block> blocks, List<String> failures, List<String> skipped) {

        public Document(String date, String generatedAt, int checked, int alreadySeen, int newItems,
                List<Block> blocks, List<String> failures) {
            this(date, generatedAt, checked, alreadySeen, newItems, blocks, failures, List.of());
        }
    }

    private BriefingRenderer() {
    }

    public static String render(Document document) {
        StringBuilder out = new StringBuilder();
        out.append("# AI 简报 ").append(document.date()).append("\n\n");

        boolean empty = document.newItems() <= 0;
        if (empty) {
            out.append("> 生成于 ").append(document.generatedAt())
                    .append(" · 今天没有新的 AI 资讯（检查 ").append(document.checked())
                    .append(" 条，全部已收录过）\n\n");
            out.append("今天所有源都没有新内容，等明天再来看看吧。\n");
        } else {
            out.append("> 生成于 ").append(document.generatedAt())
                    .append(" · 新内容 ").append(document.newItems())
                    .append(" 条（检查 ").append(document.checked())
                    .append(" 条，已收录过 ").append(document.alreadySeen()).append(" 条）\n");
            appendBlocks(out, document.blocks());
        }

        if (!document.failures().isEmpty()) {
            out.append("\n---\n\n### 本次未取到\n\n");
            for (String failure : document.failures()) {
                out.append("- ").append(safe(failure)).append('\n');
            }
        }
        if (!document.skipped().isEmpty()) {
            out.append("\n### 跳过的源（已知不可达）\n\n");
            for (String skipped : document.skipped()) {
                out.append("- ").append(safe(skipped)).append('\n');
            }
        }
        out.append("\n> ").append(IMPORTANCE_NOTE).append('\n');
        return out.toString();
    }

    private static void appendBlocks(StringBuilder out, List<Block> blocks) {
        for (String category : BriefingSources.CATEGORIES) {
            List<Block> inCategory = blocks.stream()
                    .filter(block -> category.equals(block.category()) && !block.items().isEmpty())
                    .toList();
            if (inCategory.isEmpty()) {
                continue;
            }
            out.append("\n## ").append(category).append('\n');
            for (Block block : inCategory) {
                out.append("\n### ").append(safe(block.sourceName())).append('\n');
                int number = 1;
                for (Item item : block.items()) {
                    appendItem(out, block, item, number++);
                }
            }
        }
    }

    /** 五段式：标题行 → 元信息 → 摘要 → 原题 → 链接 →（配图）。 */
    private static void appendItem(StringBuilder out, Block block, Item item, int number) {
        out.append("\n#### ").append(number).append(". ").append(safe(item.title())).append('\n');

        String meta = metaLine(block, item);
        if (meta != null) {
            out.append("> ").append(meta).append('\n');
        }

        String summary = item.summary() == null ? "" : item.summary().trim();
        if (!summary.isEmpty()) {
            out.append('\n').append(safe(BriefingText.truncate(summary, SUMMARY_LIMIT))).append('\n');
        }

        if (item.originalTitle() != null && !item.originalTitle().isBlank()) {
            out.append("\n原题：").append(safe(item.originalTitle())).append('\n');
        }
        if (item.url() != null && !item.url().isBlank()) {
            // 外部 URL 一律视为不可信：包在 < > 里并剥掉尖括号/控制字符，避免注入额外 Markdown/HTML
            String safeUrl = item.url().trim()
                    .replace("<", "").replace(">", "")
                    .replaceAll("[\\x00-\\x1F\\x7F]", "");
            out.append("\n链接：<").append(safeUrl).append(">\n");
        }
        if (item.imageRef() != null && !item.imageRef().isBlank()) {
            out.append("\n![](").append(item.imageRef()).append(")\n");
        }
    }

    /** 元信息行：来源 · 发布时间 · 重要级别 [· HN 分数]；没有的段直接省略。 */
    static String metaLine(Block block, Item item) {
        StringBuilder meta = new StringBuilder();
        String sourceName = block.sourceName() == null ? "" : block.sourceName().trim();
        if (!sourceName.isEmpty()) {
            meta.append(safe(sourceName));
        }
        String published = publishedDate(item.publishedAt());
        if (published != null) {
            if (meta.length() > 0) {
                meta.append(" · ");
            }
            meta.append(published);
        }
        if (meta.length() > 0) {
            meta.append(" · ");
        }
        meta.append(stars(block.sourceId(), item.score()));
        if (item.score() != null) {
            meta.append(" · ").append(item.score()).append(" 分");
        }
        return meta.length() == 0 ? null : meta.toString();
    }

    /** ★ / ★★ / ★★★（规则见 {@link #importance}）。 */
    static String stars(String sourceId, Integer score) {
        return "★".repeat(importance(sourceId, score));
    }

    /**
     * 重要级别（1..3），按可解释的规则：
     *
     * <ul>
     *   <li>★★★：官方一手源（openai / anthropic / deepmind）；或 HN 且 score ≥ 300</li>
     *   <li>★★：其余源（Techmeme / arXiv / 量子位 / 机器之心 / Hugging Face / Import AI …）；
     *       或 HN 且 score ≥ 100</li>
     *   <li>★：其它（HN score &lt; 100、HN 无分数、未知来源）</li>
     * </ul>
     */
    static int importance(String sourceId, Integer score) {
        String id = sourceId == null ? "" : sourceId.trim();
        if (FIRST_HAND.contains(id)) {
            return 3;
        }
        if ("hackernews".equals(id)) {
            if (score == null) {
                return 1;
            }
            if (score >= HN_THREE_STAR) {
                return 3;
            }
            return score >= HN_TWO_STAR ? 2 : 1;
        }
        return id.isEmpty() ? 1 : 2;
    }

    /** 发布时间 → {@code MM-dd}；空/不可解析返回 null（调用方整段省略）。 */
    static String publishedDate(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String text = raw.trim();
        try {
            return OffsetDateTime.parse(text).format(MONTH_DAY);
        } catch (RuntimeException ignored) {
            // 继续尝试别的格式
        }
        try {
            return ZonedDateTime.parse(text, DateTimeFormatter.RFC_1123_DATE_TIME).format(MONTH_DAY);
        } catch (RuntimeException ignored) {
            // RFC1123 会校验星期几；真实源里常写错，剥掉星期前缀再试一次
        }
        String withoutWeekday = text.replaceFirst("^[A-Za-z]{3},\\s*", "");
        if (!withoutWeekday.equals(text)) {
            try {
                return ZonedDateTime.parse(withoutWeekday,
                        DateTimeFormatter.ofPattern("d MMM yyyy HH:mm[:ss] zzz", java.util.Locale.ENGLISH))
                        .format(MONTH_DAY);
            } catch (RuntimeException ignored) {
                // 继续
            }
        }
        try {
            return LocalDate.parse(text).format(MONTH_DAY);
        } catch (RuntimeException ignored) {
            // 继续
        }
        try {
            return LocalDateTime.parse(text).format(MONTH_DAY);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    /** 失败/跳过原因与标题会原样进正文，这里再去一次标签，绝不把 HTML 写进笔记。 */
    private static String safe(String text) {
        return text == null ? "" : BriefingText.stripHtml(text).trim();
    }
}

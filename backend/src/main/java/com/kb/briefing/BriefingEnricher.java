package com.kb.briefing;

import com.kb.attachment.AttachmentResponse;
import com.kb.attachment.AttachmentService;
import com.kb.common.Times;
import com.kb.user.KbPrincipal;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 简报条目的「富化」，严格两阶段：
 *
 * <ol>
 *   <li><b>翻译</b>（独立预算 {@link #TRANSLATE_BUDGET}）：保证每条都是中文。标题与摘要<b>成对</b>翻译，
 *       要翻的那一侧失败就整体回退原文 —— 绝不允许「中文标题 + 英文摘要」这种混搭。</li>
 *   <li><b>文章页 + 配图</b>（best-effort，{@link #PAGE_BUDGET}）：抓 og:description 让摘要更充实、
 *       抓 og:image 存成附件。失败只是少张图/摘要短一点，不影响已经翻好的中文。</li>
 * </ol>
 *
 * <p>缓存（{@code briefing_cache}）按 URL 命中：第二次运行不再翻译、不再抓页、不再下载。
 * 安全上抓页与下图都要过 {@link BriefingUrls#isPublicHttpUrl}（SSRF），图片还要靠字节头校验。
 */
@Component
public class BriefingEnricher {

    private static final Logger log = LoggerFactory.getLogger(BriefingEnricher.class);

    /** 阶段一（翻译）总预算：批量提交 + 并发 8，健康时 10s 内跑完；配额耗尽会很快熔断。 */
    static final Duration TRANSLATE_BUDGET = Duration.ofSeconds(20);
    /** 阶段二（文章页 + 配图）总预算：best-effort，到点就收。 */
    static final Duration PAGE_BUDGET = Duration.ofSeconds(15);
    static final Duration PAGE_TIMEOUT = Duration.ofSeconds(12);
    static final Duration IMAGE_TIMEOUT = Duration.ofSeconds(12);
    /** 单张图片上限 5 MB。 */
    static final int MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    /** 摘要上限（按码点）。 */
    static final int MAX_SUMMARY_CHARS = 300;
    /** 缓存里 {@code image_remote} 用空串表示「文章页看过但没有图」，避免每次重抓。 */
    static final String NO_IMAGE_MARKER = "";

    private final BriefingProperties properties;
    private final BriefingCache cache;
    private final TranslationClient translation;
    private final HttpTransport transport;
    private final AttachmentService attachments;
    private final BriefingAttachmentIndex attachmentIndex;
    private final Clock clock;

    public BriefingEnricher(BriefingProperties properties, BriefingCache cache, TranslationClient translation,
            HttpTransport transport, AttachmentService attachments, BriefingAttachmentIndex attachmentIndex,
            Clock clock) {
        this.properties = properties;
        this.cache = cache;
        this.translation = translation;
        this.transport = transport;
        this.attachments = attachments;
        this.attachmentIndex = attachmentIndex;
        this.clock = clock;
    }

    /**
     * @param sourceId 源 id（用于附件原始名，如 {@code openai-3.jpg}）
     * @param ordinal 该条目在本源内的序号（从 1 开始）
     */
    public record Target(String url, String title, String summary, String sourceId, int ordinal) {
    }

    /**
     * @param displayTitle 展示标题（有译文时是中文；null 表示沿用原标题）
     * @param displaySummary 展示摘要（与标题同语言；null 表示沿用 RSS 摘要）
     * @param imageRemote 配图远程地址（{@link #NO_IMAGE_MARKER} 表示看过但没有图）
     * @param imageRef 形如 {@code /api/attachments/12}
     * @param attachmentId 附件 id（用于把 note_id 回填到简报笔记上）
     * @param translationFailed 本轮翻译是否失败（true 时刻意不写译文，下次运行重试）
     */
    public record Enrichment(String displayTitle, String displaySummary, String imageRemote, String imageRef,
            Long attachmentId, boolean translationFailed) {

        static final Enrichment EMPTY = new Enrichment(null, null, null, null, null, false);

        Enrichment withTranslations(String title, String summary, boolean failed) {
            return new Enrichment(title, summary, imageRemote, imageRef, attachmentId, failed);
        }

        Enrichment withPage(String remote, String ref, Long id, String summary) {
            return new Enrichment(displayTitle, summary, remote, ref, id, translationFailed);
        }
    }

    public Map<String, Enrichment> enrichAll(KbPrincipal principal, List<Target> targets) {
        Map<String, Enrichment> results = new ConcurrentHashMap<>();
        if (targets.isEmpty()) {
            return results;
        }
        long started = System.currentTimeMillis();
        String cutoff = Times.format(Instant.now(clock).minus(Duration.ofDays(properties.getCacheTtlDays())));
        Map<String, BriefingCache.Entry> cached = new ConcurrentHashMap<>();
        for (Target target : targets) {
            cache.find(principal.spaceId(), target.url(), cutoff)
                    .ifPresent(entry -> cached.put(target.url(), entry));
        }

        // ---- 阶段一：翻译（全部条目，独立预算）----
        AtomicInteger translated = new AtomicInteger();
        AtomicInteger failedTranslations = new AtomicInteger();
        translatePhase(targets, results, cached, translated, failedTranslations);
        if (failedTranslations.get() > 0) {
            log.warn("翻译不可用：本次 {} 处翻译失败，已保留原文（不会中英混搭）。"
                    + "失败条目不会写入译文缓存，额度恢复后下次运行会重试。",
                    failedTranslations.get());
        }

        // ---- 阶段二：文章页 + 配图（best-effort，独立预算）----
        AtomicInteger pages = new AtomicInteger();
        AtomicInteger images = new AtomicInteger();
        Set<String> usedSha = ConcurrentHashMap.newKeySet();
        runPhase(targets, PAGE_BUDGET, target -> {
            Enrichment base = results.getOrDefault(target.url(), Enrichment.EMPTY);
            results.put(target.url(), enrichWithPage(principal, target, base,
                    pages, images, usedSha));
        });

        // ---- 统一回写缓存：两个阶段无论走哪条提前返回路径都已经合并成最终结果 ----
        String now = Times.format(Instant.now(clock));
        for (Target target : targets) {
            Enrichment finalResult = results.get(target.url());
            if (finalResult == null) {
                continue;
            }
            BriefingCache.Entry previous = cached.get(target.url());
            String remote = finalResult.imageRemote() != null
                    ? finalResult.imageRemote()
                    : (previous == null ? null : previous.imageUrl());
            cache.save(principal.spaceId(), target.url(),
                    new BriefingCache.Entry(finalResult.displayTitle(), finalResult.displaySummary(), remote,
                            finalResult.attachmentId(), finalResult.translationFailed()),
                    now);
        }

        int untranslated = (int) results.values().stream()
                .filter(enrichment -> enrichment.displayTitle() == null).count();
        log.info("简报富化: 条目={} 命中缓存={} 翻译={} 抓文章页={} 下载配图={} 仍为原文={} 耗时={}ms",
                targets.size(), cached.size(), translated.get(), pages.get(), images.get(), untranslated,
                System.currentTimeMillis() - started);
        return results;
    }

    private interface PhaseTask {
        void run(Target target);
    }

    /** 跑一个阶段：并发 + 阶段总预算；到点放弃剩余（不影响其他阶段已完成的成果）。 */
    private void runPhase(List<Target> targets, Duration phaseBudget, PhaseTask task) {
        if (targets.isEmpty()) {
            return;
        }
        long deadline = System.currentTimeMillis() + phaseBudget.toMillis();
        List<Future<?>> futures = new ArrayList<>(targets.size());
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (Target target : targets) {
                futures.add(pool.submit(() -> {
                    try {
                        task.run(target);
                    } catch (RuntimeException e) {
                        log.debug("富化子任务失败（保留原文）: {} ({})", target.url(), e.toString());
                    }
                }));
            }
            for (Future<?> future : futures) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) {
                    future.cancel(true);
                    continue;
                }
                try {
                    future.get(remaining, TimeUnit.MILLISECONDS);
                } catch (TimeoutException e) {
                    future.cancel(true);
                } catch (ExecutionException e) {
                    log.debug("富化子任务异常: {}", String.valueOf(e.getCause()));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    /** 一条待翻译的条目：标题与摘要是否需要翻。 */
    private record PairTask(Target target, String summary, boolean titleNeeds, boolean summaryNeeds) {
    }

    /**
     * 阶段一：把所有要翻的标题/摘要<b>批量</b>交给 provider（DeepL 一次 50 条），
     * 再按「成对」规则回填：任何一侧失败，这条的标题与摘要都保留原文（绝不中英混搭）。
     */
    private void translatePhase(List<Target> targets, Map<String, Enrichment> results,
            Map<String, BriefingCache.Entry> cached, AtomicInteger translated,
            AtomicInteger failedTranslations) {
        List<PairTask> tasks = new ArrayList<>();
        for (Target target : targets) {
            BriefingCache.Entry entry = cached.get(target.url());
            // 缓存里已有的图片信息要带上，阶段二才不会把「已看过、没有图」的页面重抓一遍
            Enrichment base = entry == null ? Enrichment.EMPTY
                    : new Enrichment(entry.titleZh(), entry.summaryZh(), entry.imageUrl(),
                            imageRef(entry.attachmentId()), entry.attachmentId(), entry.translationFailed());
            results.put(target.url(), base);
            // 真正命中译文：跳过翻译。translation_failed=1 只算「页/图缓存」，翻译仍要重试
            if (entry != null && !entry.translationFailed()
                    && (entry.titleZh() != null || entry.summaryZh() != null)) {
                continue;
            }
            if (!properties.isTranslate()) {
                continue;
            }
            String summary = itemSummary(target);
            boolean titleNeeds = target.title() != null && !target.title().isBlank()
                    && !BriefingText.looksChinese(target.title());
            boolean summaryNeeds = !summary.isBlank() && !BriefingText.looksChinese(summary);
            if (!titleNeeds && !summaryNeeds) {
                continue;                                  // 本来就全中文，不需要翻译
            }
            tasks.add(new PairTask(target, summary, titleNeeds, summaryNeeds));
        }
        if (tasks.isEmpty()) {
            return;
        }
        List<String> texts = new ArrayList<>(tasks.size() * 2);
        for (PairTask task : tasks) {
            if (task.titleNeeds()) {
                texts.add(task.target().title());
            }
            if (task.summaryNeeds()) {
                texts.add(task.summary());
            }
        }
        List<String> translations;
        try {
            translations = translation.translateAll(texts);
        } catch (RuntimeException e) {
            log.warn("批量翻译失败（{}），本次全部保留原文", e.getMessage());
            failedTranslations.addAndGet(tasks.size());
            for (PairTask task : tasks) {
                markTranslationFailed(results, task.target().url());
            }
            return;
        }
        if (translations == null || translations.size() != texts.size()) {
            log.warn("翻译返回条数与请求不一致（{} / {}），本次全部保留原文",
                    translations == null ? "null" : translations.size(), texts.size());
            failedTranslations.addAndGet(tasks.size());
            for (PairTask task : tasks) {
                markTranslationFailed(results, task.target().url());
            }
            return;
        }
        int cursor = 0;
        for (PairTask task : tasks) {
            String titleZh = task.titleNeeds() ? translations.get(cursor++) : null;
            String summaryZh = task.summaryNeeds() ? translations.get(cursor++) : null;
            if ((task.titleNeeds() && isBlank(titleZh)) || (task.summaryNeeds() && isBlank(summaryZh))) {
                failedTranslations.incrementAndGet();
                markTranslationFailed(results, task.target().url());   // 成对失败 → 保持原文，下次重试
                continue;
            }
            translated.incrementAndGet();
            Enrichment base = results.getOrDefault(task.target().url(), Enrichment.EMPTY);
            results.put(task.target().url(), base.withTranslations(titleZh, summaryZh, false));
        }
    }

    /** 只把「失败待重试」这个标记写进结果，不写译文；统一回写时落到 translation_failed 列。 */
    private static void markTranslationFailed(Map<String, Enrichment> results, String url) {
        Enrichment current = results.getOrDefault(url, Enrichment.EMPTY);
        results.put(url, current.withTranslations(null, null, true));
    }

    private static boolean isBlank(String text) {
        return text == null || text.isBlank();
    }

    /** 阶段二：文章页补摘要 + 配图（都不强制）。缓存统一在 enrichAll 末尾回写，这里只合并结果。 */
    private Enrichment enrichWithPage(KbPrincipal principal, Target target, Enrichment base,
            AtomicInteger pages, AtomicInteger images, Set<String> usedSha) {
        if (base.imageRemote() != null) {
            return base;   // 页看过了（含「看过但没有图」的空串哨兵）
        }
        if (!properties.isFetchArticle() || !BriefingUrls.isPublicHttpUrl(target.url())) {
            return base;
        }
        ArticleExtractor.Page page;
        try {
            page = ArticleExtractor.parse(transport.get(target.url(), JdkHttpTransport.ACCEPT_HTML,
                    PAGE_TIMEOUT), target.url());
            pages.incrementAndGet();
        } catch (RuntimeException e) {
            log.debug("文章页抓取失败（用 RSS 摘要）: {} ({})", target.url(), e.getMessage());
            return base;
        }

        String displaySummary = base.displaySummary();
        if (page.description() != null && !page.description().isBlank()) {
            String candidate = BriefingText.truncate(
                    BriefingText.collapse(BriefingText.stripHtml(page.description())), MAX_SUMMARY_CHARS);
            if (!candidate.equals(itemSummary(target))) {
                if (!properties.isTranslate() || BriefingText.looksChinese(candidate)) {
                    displaySummary = candidate;
                } else {
                    String candidateZh = tryTranslate(candidate, new AtomicInteger());
                    if (candidateZh == null) {
                        log.debug("文章页摘要翻译失败，保留原摘要: {}", target.url());
                    }
                    displaySummary = candidateZh != null ? candidateZh : displaySummary;   // 翻好才用
                }
            }
        }

        Long attachmentId = null;
        String remote = page.imageUrl();
        if (remote != null) {
            attachmentId = downloadImage(principal, target, remote, images, usedSha);
        }
        return base.withPage(remote == null ? NO_IMAGE_MARKER : remote, imageRef(attachmentId), attachmentId,
                displaySummary);
    }

    private static String imageRef(Long attachmentId) {
        return attachmentId == null ? null : "/api/attachments/" + attachmentId;
    }

    /** RSS 自带摘要（去标签 + 截断），用来和文章页摘要比较。 */
    private static String itemSummary(Target target) {
        String text = BriefingText.collapse(BriefingText.stripHtml(
                target.summary() == null ? "" : target.summary()));
        return BriefingText.truncate(text, MAX_SUMMARY_CHARS);
    }

    private String tryTranslate(String text, AtomicInteger counter) {
        if (text == null || text.isBlank()) {
            return null;
        }
        try {
            String zh = translation.translate(text);
            counter.incrementAndGet();
            return zh;
        } catch (RuntimeException e) {
            log.debug("翻译失败（保留英文）: {} ({})", BriefingText.truncate(text, 30), e.getMessage());
            return null;
        }
    }

    /**
     * 下载首图 → 算 sha256 → 已有同字节的附件就复用 → 否则通过附件服务上传。
     * 同一篇简报里同一张图只用一次（多站常把站点默认图当 og:image）。
     */
    private Long downloadImage(KbPrincipal principal, Target target, String imageUrl, AtomicInteger images,
            Set<String> usedSha) {
        if (!BriefingUrls.isPublicHttpUrl(imageUrl)) {
            log.debug("配图地址被 SSRF 规则拒绝: {}", imageUrl);
            return null;
        }
        byte[] bytes;
        try {
            bytes = transport.getBytes(imageUrl, IMAGE_TIMEOUT);
        } catch (RuntimeException e) {
            log.debug("配图下载失败: {} ({})", imageUrl, e.getMessage());
            return null;
        }
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_IMAGE_BYTES) {
            return null;
        }
        String mime = sniffImageMime(bytes);
        if (mime == null) {
            log.debug("配图不是图片字节（可能是反爬页面）: {}", imageUrl);
            return null;
        }
        String sha256 = sha256(bytes);
        if (!usedSha.add(sha256)) {
            log.debug("同一篇简报里这张图已经用过，跳过: {}", imageUrl);
            return null;
        }
        Optional<Long> existing = attachmentIndex.findBySha256(principal.spaceId(), sha256);
        if (existing.isPresent()) {
            log.debug("命中已有附件（sha256 相同），不再重复上传: {}", imageUrl);
            return existing.get();
        }
        if (images.incrementAndGet() > properties.getMaxImages()) {
            images.decrementAndGet();
            return null;
        }
        String name = target.sourceId() + "-" + target.ordinal() + extensionOf(mime);
        try {
            AttachmentResponse response = attachments.upload(principal,
                    new InMemoryMultipartFile(bytes, name, mime), null);
            return response.id();
        } catch (RuntimeException e) {
            images.decrementAndGet();
            log.debug("配图落库失败: {} ({})", imageUrl, e.getMessage());
            return null;
        }
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("JVM 缺少 SHA-256", e);
        }
    }

    /** 只认真正的图片字节，避免把 403 的 HTML 当图片存进附件库。 */
    static String sniffImageMime(byte[] bytes) {
        if (bytes == null || bytes.length < 12) {
            return null;
        }
        if ((bytes[0] & 0xFF) == 0x89 && bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G') {
            return "image/png";
        }
        if ((bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xD8 && (bytes[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F') {
            return "image/gif";
        }
        if (bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F'
                && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P') {
            return "image/webp";
        }
        return null;
    }

    private static String extensionOf(String mime) {
        return switch (mime) {
            case "image/png" -> ".png";
            case "image/gif" -> ".gif";
            case "image/webp" -> ".webp";
            default -> ".jpg";
        };
    }
}

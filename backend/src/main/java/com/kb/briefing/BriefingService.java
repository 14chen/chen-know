package com.kb.briefing;

import com.kb.common.ApiException;
import com.kb.common.Times;
import com.kb.folder.FolderRepository;
import com.kb.folder.FolderRow;
import com.kb.note.CreateNoteRequest;
import com.kb.note.NoteDetail;
import com.kb.note.NoteService;
import com.kb.user.KbPrincipal;
import com.kb.user.SpaceRepository;
import com.kb.user.UserAccount;
import com.kb.user.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.ExecutorService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * BRIEFING.md §3/§5：一次简报的编排 —— 解析归属空间 → 并行抓取 → 跨天去重 → 渲染 → 写笔记 → 记录 run。
 *
 * <p>手动接口与定时任务/启动补抓共用同一把锁（{@link #running}），同一空间同一时刻只会有一个 run。
 */
@Service
public class BriefingService {

    private static final Logger log = LoggerFactory.getLogger(BriefingService.class);
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    /** 单源最多等这么久（transport 单次 20s，超时会自己重试一次，这里留足余量）。 */
    /** 抖动容忍：失败源数 ≤ 10%（至少容忍 1 个）仍算 success；失败如实写进正文，不隐藏。 */
    static final double FAILURE_TOLERANCE_RATIO = 0.1;
    private static final Duration STALE_RUN_AFTER = Duration.ofMinutes(30);
    private static final String NOTE_TITLE_PREFIX = "AI 简报 ";
    /** 被 skip-sources 跳过的源在报告/正文里的说明。 */
    static final String SKIPPED_REASON = "已知不可达（Cloudflare 反爬，本次已跳过）";

    private final BriefingProperties properties;
    private final BriefingFetcherRegistry registry;
    private final BriefingRepository repository;
    private final NoteService noteService;
    private final FolderRepository folderRepository;
    private final UserRepository userRepository;
    private final SpaceRepository spaceRepository;
    private final BriefingEnricher enricher;
    private final BriefingAttachmentIndex attachmentIndex;
    private final Clock clock;

    /** spaceId → 正在跑；同一空间并发第二个请求直接 409（BRIEFING.md §6）。 */
    private final Set<Long> running = ConcurrentHashMap.newKeySet();

    public BriefingService(BriefingProperties properties, BriefingFetcherRegistry registry,
            BriefingRepository repository, NoteService noteService, FolderRepository folderRepository,
            UserRepository userRepository, SpaceRepository spaceRepository, BriefingEnricher enricher,
            BriefingAttachmentIndex attachmentIndex, Clock clock) {
        this.properties = properties;
        this.registry = registry;
        this.repository = repository;
        this.noteService = noteService;
        this.folderRepository = folderRepository;
        this.userRepository = userRepository;
        this.spaceRepository = spaceRepository;
        this.enricher = enricher;
        this.attachmentIndex = attachmentIndex;
        this.clock = clock;
    }

    /** BRIEFING.md §6 {@code POST /api/briefing/run}：只归档到调用者自己的空间。 */
    public BriefingRunResponse run(long userId, long spaceId) {
        return run(userId, spaceId, "manual");
    }

    /** 手动/定时/补抓共用；{@code trigger} 只用于日志与诊断。 */
    public BriefingRunResponse run(long userId, long spaceId, String trigger) {
        if (!properties.isEnabled()) {
            throw ApiException.forbidden("简报功能已关闭（kb.briefing.enabled=false），已拒绝执行，未发起任何外网请求");
        }
        if (!running.add(spaceId)) {
            throw ApiException.conflict("该空间已有简报任务在运行，请稍后重试");
        }
        try {
            return execute(userId, spaceId, trigger);
        } finally {
            running.remove(spaceId);
        }
    }

    /**
     * 定时任务与启动补抓共用：今天已经有成功/部分成功的 run，或还没到今天该生成的时刻，就直接跳过。
     */
    public void runIfDue(String reason) {
        if (!properties.isEnabled()) {
            log.debug("简报开关关闭，跳过 {{}}", reason);
            return;
        }
        String owner = properties.getOwner();
        if (owner == null || owner.isBlank()) {
            log.debug("未配置 kb.briefing.owner，跳过 {{}}", reason);
            return;
        }
        UserAccount user = userRepository.findByUsername(owner.trim()).orElse(null);
        if (user == null) {
            log.warn("kb.briefing.owner={{}} 在库里不存在，跳过 {}", owner, reason);
            return;
        }
        Long spaceId = spaceRepository.findIdByOwner(user.id()).orElse(null);
        if (spaceId == null) {
            log.warn("账号 {{}} 没有空间，跳过 {}", owner, reason);
            return;
        }
        String today = LocalDate.now(clock).toString();
        if (repository.hasRunToday(spaceId, today)) {
            log.debug("{{}}：今天（{{}}）已有简报，跳过", reason, today);
            return;
        }
        LocalTime due = properties.dueTime();
        LocalTime now = LocalTime.now(clock);
        if (now.isBefore(due)) {
            log.debug("{{}}：还没到今天生成时刻 {{}}（当前 {{}}），跳过", reason, due, now);
            return;
        }
        try {
            BriefingRunResponse response = run(user.id(), spaceId, reason);
            log.info("简报自动运行完成（{{}}）: space={{}} status={{}} new={{}}", reason, spaceId,
                    response.status(), response.newItems());
        } catch (ApiException e) {
            log.info("简报自动运行跳过（{{}}）: {}", reason, e.getMessage());
        } catch (RuntimeException e) {
            log.warn("简报自动运行失败（{{}}）: {}", reason, e.getMessage(), e);
        }
    }

    /** 真正的 run 流程；任何异常都落库为 failed 并在响应里体现，不向外抛（除非并发冲突）。 */
    private BriefingRunResponse execute(long userId, long spaceId, String trigger) {
        long startedMillis = System.currentTimeMillis();
        Instant now = Instant.now(clock);
        repository.markStaleRunningFailed(spaceId, Times.format(now.minus(STALE_RUN_AFTER)),
                Times.format(now));
        long runId = repository.insertRun(spaceId, Times.format(now));

        List<SourceReportEntry> report = new ArrayList<>();
        int checked = 0;
        int included = 0;
        try {
            Map<String, SourceFetch> fetched = fetchAll(properties.getPerSource());
            checked = fetched.values().stream().mapToInt(result -> result.items().size()).sum();

            Set<String> seen = repository.seenUrls(spaceId);
            Set<String> batchUrls = new LinkedHashSet<>();
            List<String> newUrls = new ArrayList<>();
            List<String> failures = new ArrayList<>();
            List<String> skipped = new ArrayList<>();
            List<IncludedItem> includedItems = new ArrayList<>();
            for (BriefingSource source : registry.sourcesInOrder()) {
                if (properties.isSkipped(source.id())) {
                    // 已知不可达（反爬）：不请求、不计失败、不影响 status
                    report.add(new SourceReportEntry(source.id(), true, 0, SKIPPED_REASON, true));
                    skipped.add(source.name() + "：" + SKIPPED_REASON);
                    continue;
                }
                SourceFetch result = fetched.getOrDefault(source.id(),
                        new SourceFetch(source, List.of(), false, "未抓取到结果"));
                List<IncludedItem> items = new ArrayList<>();
                for (RawItem raw : result.items()) {
                    String url = BriefingUrls.normalize(raw.url());
                    if (!BriefingUrls.isHttpUrl(url) || !batchUrls.add(url) || seen.contains(url)) {
                        continue;
                    }
                    items.add(new IncludedItem(source, BriefingText.clean(raw.title()), url,
                            BriefingText.summary(raw.summary()), raw.score(), items.size() + 1,
                            raw.publishedAt()));
                    newUrls.add(url);
                    if (items.size() >= properties.getPerSource()) {
                        break;
                    }
                }
                included += items.size();
                includedItems.addAll(items);
                report.add(new SourceReportEntry(result.source().id(), result.ok(), result.items().size(),
                        result.error()));
                if (!result.ok()) {
                    failures.add(result.source().name() + "：" + result.error());
                }
                log.debug("简报源 {{}}（{{}}）: 取到 {{}} 条，收录 {{}} 条{{}}", result.source().id(),
                        result.source().kind(), result.items().size(), items.size(),
                        result.ok() ? "" : "，失败：" + result.error());
            }

            Map<String, BriefingEnricher.Enrichment> enrichments = enrich(spaceId, userId, includedItems);
            List<BriefingRenderer.Block> blocks = buildBlocks(includedItems, enrichments);

            String date = LocalDate.now(clock).toString();
            String markdown = BriefingRenderer.render(new BriefingRenderer.Document(date,
                    LocalDateTimeFormatter.format(clock), checked, Math.max(0, checked - included), included,
                    blocks, failures, skipped));

            Long folderId = resolveFolder(spaceId, properties.getFolder());
            NoteDetail note = noteService.create(userId, spaceId,
                    new CreateNoteRequest(folderId, NOTE_TITLE_PREFIX + date, markdown));
            List<String> tags = properties.getTags();
            if (tags != null && !tags.isEmpty()) {
                noteService.setTags(spaceId, note.id(), tags);
            }
            // 附件挂到简报笔记上：删笔记时附件才能被一起清理
            List<Long> attachments = enrichments.values().stream()
                    .map(BriefingEnricher.Enrichment::attachmentId)
                    .filter(java.util.Objects::nonNull)
                    .distinct()
                    .toList();
            if (!attachments.isEmpty()) {
                int linked = attachmentIndex.backfillNoteId(spaceId, note.id(), attachments);
                log.info("简报附件已挂到笔记 {}: 本次用到 {} 个附件，回填 note_id {} 个", note.id(),
                        attachments.size(), linked);
            }
            repository.markSeen(spaceId, newUrls, Times.format(Instant.now(clock)));

            int attempted = (int) report.stream().filter(entry -> !entry.skipped()).count();
            int failed = (int) report.stream().filter(entry -> !entry.skipped() && !entry.ok()).count();
            String status = decideStatus(attempted, failed);
            if ("failed".equals(status)) {
                log.warn("简报没有任何源取到内容: trigger={} space={} attempted={}", trigger, spaceId, attempted);
            }
            repository.finishRun(runId, Times.format(Instant.now(clock)), status, note.id(), checked, included,
                    reportToJson(report), "failed".equals(status) ? "所有源都没取到内容" : null);
            log.info("简报完成: trigger={} space={} status={} new={} checked={} note={} 失败源={}/{} 耗时={}ms",
                    trigger, spaceId, status, included, checked, note.id(), failed, attempted,
                    System.currentTimeMillis() - startedMillis);
            return new BriefingRunResponse(runId, status, checked, included, note.id(), report);
        } catch (RuntimeException e) {
            String message = e.getMessage() == null || e.getMessage().isBlank()
                    ? e.getClass().getSimpleName() : e.getMessage();
            try {
                repository.finishRun(runId, Times.format(Instant.now(clock)), "failed", null, checked,
                        included, reportToJson(report), message);
            } catch (RuntimeException ignored) {
                // 落库失败时不再掩盖原始异常
            }
            log.warn("简报失败: trigger={{}} space={{}} 原因={{}}", trigger, spaceId, message, e);
            return new BriefingRunResponse(runId, "failed", checked, included, null, report);
        }
    }

    /** 多源并行（虚拟线程）：只抓不在 skip-sources 里的源；单源失败只影响自己。 */
    private Map<String, SourceFetch> fetchAll(int perSource) {
        List<BriefingFetcher> fetchers = registry.all().stream()
                .filter(fetcher -> !properties.isSkipped(fetcher.source().id()))
                .toList();
        Map<String, SourceFetch> results = new java.util.LinkedHashMap<>(fetchers.size());
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<List<RawItem>>> futures = new ArrayList<>(fetchers.size());
            for (BriefingFetcher fetcher : fetchers) {
                futures.add(executor.submit(() -> fetcher.fetch(perSource)));
            }
            for (int index = 0; index < fetchers.size(); index++) {
                BriefingSource source = fetchers.get(index).source();
                Duration budget = BriefingSources.budget(source.id());
                try {
                    results.put(source.id(), new SourceFetch(source, futures.get(index).get(
                            budget.toSeconds(), TimeUnit.SECONDS), true, null));
                } catch (TimeoutException e) {
                    futures.get(index).cancel(true);
                    results.put(source.id(), new SourceFetch(source, List.of(), false,
                            "超时 " + budget.toSeconds() + "s 无响应"));
                } catch (ExecutionException e) {
                    results.put(source.id(), new SourceFetch(source, List.of(), false, describe(e.getCause())));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    results.put(source.id(), new SourceFetch(source, List.of(), false, "抓取被中断"));
                }
            }
        }
        return results;
    }

    /**
     * status 判定（抖动容忍）：没有失败 → success；失败源数 ≤ 10%（至少容忍 1 个）→ 仍 success
     * （失败照样写进「本次未取到」）；更多失败 → partial；全部失败 → failed。
     */
    static String decideStatus(int attempted, int failed) {
        if (attempted <= 0 || failed <= 0) {
            return "success";
        }
        if (failed >= attempted) {
            return "failed";
        }
        int tolerated = Math.max(1, (int) Math.floor(attempted * FAILURE_TOLERANCE_RATIO));
        return failed <= tolerated ? "success" : "partial";
    }

    /** 一条入选条目（还没富化）。{@code ordinal} 是它在源内的序号，用于附件原始名。 */
    private record IncludedItem(BriefingSource source, String title, String url, String summary, Integer score,
            int ordinal, String publishedAt) {
    }

    /** 翻译 + 文章页 + 配图；关掉两个开关时直接空转。 */
    private Map<String, BriefingEnricher.Enrichment> enrich(long spaceId, long userId,
            List<IncludedItem> items) {
        if (items.isEmpty() || (!properties.isTranslate() && !properties.isFetchArticle())) {
            return Map.of();
        }
        List<BriefingEnricher.Target> targets = items.stream()
                .map(item -> new BriefingEnricher.Target(item.url(), item.title(), item.summary(),
                        item.source().id(), item.ordinal()))
                .toList();
        try {
            return enricher.enrichAll(new KbPrincipal(userId, "", "", "member", spaceId), targets);
        } catch (RuntimeException e) {
            // 富化是锦上添花，挂了也要继续出简报
            log.warn("简报富化整体失败，按原文输出: {}", e.toString());
            return Map.of();
        }
    }

    /** 按源顺序装块；有译文就用译文，并保留原题做对照，配图插在条目下面。 */
    private static List<BriefingRenderer.Block> buildBlocks(List<IncludedItem> items,
            Map<String, BriefingEnricher.Enrichment> enrichments) {
        List<BriefingRenderer.Block> blocks = new ArrayList<>();
        for (BriefingSource source : BriefingSources.ALL) {
            List<BriefingRenderer.Item> rendered = new ArrayList<>();
            for (IncludedItem item : items) {
                if (!item.source().id().equals(source.id())) {
                    continue;
                }
                BriefingEnricher.Enrichment enrichment = enrichments.getOrDefault(item.url(),
                        BriefingEnricher.Enrichment.EMPTY);
                String title = enrichment.displayTitle() == null || enrichment.displayTitle().isBlank()
                        ? item.title() : enrichment.displayTitle();
                String summary = enrichment.displaySummary() == null || enrichment.displaySummary().isBlank()
                        ? item.summary() : enrichment.displaySummary();
                String originalTitle = title.equals(item.title()) ? null : item.title();
                rendered.add(new BriefingRenderer.Item(title, item.url(), summary, item.score(),
                        originalTitle, enrichment.imageRef(), item.publishedAt()));
            }
            blocks.add(new BriefingRenderer.Block(source.name(), source.category(), rendered, source.id()));
        }
        return blocks;
    }

    private static String describe(Throwable error) {
        if (error == null) {
            return "未知错误";
        }
        if (error instanceof BriefingFetchException) {
            String message = error.getMessage();
            return message == null || message.isBlank() ? "抓取失败" : message;
        }
        String message = error.getMessage();
        return error.getClass().getSimpleName() + (message == null || message.isBlank() ? "" : " " + message);
    }

    /** 按名字找现有目录；没有就返回 null（契约要求：不自动建目录）。 */
    private Long resolveFolder(long spaceId, String folderName) {
        if (folderName == null || folderName.isBlank()) {
            return null;
        }
        String wanted = folderName.trim();
        for (FolderRow folder : folderRepository.listAlive(spaceId)) {
            if (folder.name().equalsIgnoreCase(wanted)) {
                return folder.id();
            }
        }
        return null;
    }

    public static List<SourceReportEntry> parseReport(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            List<SourceReportEntry> entries = new ArrayList<>();
            for (Object element : MiniJson.asArray(MiniJson.parse(json))) {
                Map<String, Object> row = MiniJson.asObject(element);
                Integer count = MiniJson.integer(row.get("count"));
                entries.add(new SourceReportEntry(MiniJson.string(row.get("source")),
                        Boolean.TRUE.equals(row.get("ok")), count == null ? 0 : count,
                        MiniJson.string(row.get("error")), Boolean.TRUE.equals(row.get("skipped"))));
            }
            return entries;
        } catch (RuntimeException e) {
            return List.of();
        }
    }

    static String reportToJson(List<SourceReportEntry> report) {
        List<Map<String, Object>> rows = new ArrayList<>(report.size());
        for (SourceReportEntry entry : report) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("source", entry.source());
            row.put("ok", entry.ok());
            row.put("count", entry.count());
            row.put("error", entry.error());
            row.put("skipped", entry.skipped());
            rows.add(row);
        }
        return MiniJson.write(rows);
    }

    private record SourceFetch(BriefingSource source, List<RawItem> items, boolean ok, String error) {
    }

    /** 「生成于」用的墙钟格式（契约 §4 示例是本地时间）。 */
    private static final class LocalDateTimeFormatter {

        private LocalDateTimeFormatter() {
        }

        static String format(Clock clock) {
            return java.time.LocalDateTime.now(clock).format(STAMP);
        }
    }
}

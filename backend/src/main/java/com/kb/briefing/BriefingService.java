package com.kb.briefing;

import com.kb.common.ApiException;
import com.kb.common.Times;
import com.kb.folder.FolderRepository;
import com.kb.folder.FolderRow;
import com.kb.note.CreateNoteRequest;
import com.kb.note.NoteDetail;
import com.kb.analysis.AnalysisRequest;
import com.kb.analysis.AnalysisResult;
import com.kb.analysis.StructuredAnalysisService;
import com.kb.note.NoteService;
import com.kb.ops.RunMetricsService;
import com.kb.quality.QualityGate;
import com.kb.quality.QualityInput;
import com.kb.quality.QualityProperties;
import com.kb.quality.QualityReportRepository;
import com.kb.quality.QualityResult;
import com.kb.run.RunLauncher;
import com.kb.run.RunProgressRepository;
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
import org.springframework.dao.DataAccessException;
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
    private static final SemanticDeduper DEDUPER = new SemanticDeduper();

    private final BriefingProperties properties;
    private final BriefingFetcherRegistry registry;
    private final BriefingRepository repository;
    private final NoteService noteService;
    private final FolderRepository folderRepository;
    private final UserRepository userRepository;
    private final SpaceRepository spaceRepository;
    private final BriefingEnricher enricher;
    private final BriefingAttachmentIndex attachmentIndex;
    private final QualityGate qualityGate;
    private final QualityReportRepository qualityRepository;
    private final QualityProperties qualityProperties;
    private final BriefingItemRepository itemRepository;
    private final StructuredAnalysisService analysis;
    private final BriefingPersonalizer personalizer;
    private final RunLauncher launcher;
    private final RunProgressRepository runProgress;
    private final RunMetricsService metrics;
    private final SourceHealthService sourceHealth;
    private final Clock clock;

    /** spaceId → 正在跑；同一空间并发第二个请求直接 409（BRIEFING.md §6）。 */
    private final Set<Long> running = ConcurrentHashMap.newKeySet();

    public BriefingService(BriefingProperties properties, BriefingFetcherRegistry registry,
            BriefingRepository repository, NoteService noteService, FolderRepository folderRepository,
            UserRepository userRepository, SpaceRepository spaceRepository, BriefingEnricher enricher,
            BriefingAttachmentIndex attachmentIndex, QualityGate qualityGate,
            QualityReportRepository qualityRepository, QualityProperties qualityProperties,
            BriefingItemRepository itemRepository, StructuredAnalysisService analysis,
            BriefingPersonalizer personalizer, RunLauncher launcher, RunProgressRepository runProgress,
            RunMetricsService metrics, SourceHealthService sourceHealth, Clock clock) {
        this.properties = properties;
        this.registry = registry;
        this.repository = repository;
        this.noteService = noteService;
        this.folderRepository = folderRepository;
        this.userRepository = userRepository;
        this.spaceRepository = spaceRepository;
        this.enricher = enricher;
        this.attachmentIndex = attachmentIndex;
        this.qualityGate = qualityGate;
        this.qualityRepository = qualityRepository;
        this.qualityProperties = qualityProperties;
        this.itemRepository = itemRepository;
        this.analysis = analysis;
        this.personalizer = personalizer;
        this.launcher = launcher;
        this.runProgress = runProgress;
        this.metrics = metrics;
        this.sourceHealth = sourceHealth;
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
            return execute(userId, spaceId, trigger, null);
        } catch (DataAccessException e) {
            // DB 部分唯一索引：多实例下的并发锁（JVM 内锁只挡同进程）
            throw ApiException.conflict("该空间已有简报任务在运行，请稍后重试");
        } finally {
            running.remove(spaceId);
        }
    }

    /**
     * 异步模式：先插入 run 行（DB 唯一索引负责并发锁），立即返回 runId，后台再执行。
     * 同步 POST /run 的行为完全不变。
     */
    public long runAsync(long userId, long spaceId, String trigger) {
        if (!properties.isEnabled()) {
            throw ApiException.forbidden("简报功能已关闭（kb.briefing.enabled=false），已拒绝执行");
        }
        long runId;
        try {
            runId = repository.insertRun(spaceId, Times.format(Instant.now(clock)));
        } catch (DataAccessException e) {
            throw ApiException.conflict("该空间已有简报任务在运行，请稍后重试");
        }
        try {
            launcher.submit("briefing", spaceId, runId, () -> execute(userId, spaceId, trigger, runId));
        } catch (RuntimeException e) {
            repository.finishRun(runId, Times.format(Instant.now(clock)), "failed", null, 0, 0, "[]",
                    "异步任务启动失败");
            throw e;
        }
        return runId;
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
    private BriefingRunResponse execute(long userId, long spaceId, String trigger, Long preallocatedRunId) {
        long startedMillis = System.currentTimeMillis();
        Instant now = Instant.now(clock);
        analysis.beginRun();   // 每次简报运行重置 AI 分析的成本预算
        repository.markStaleRunningFailed(spaceId, Times.format(now.minus(STALE_RUN_AFTER)),
                Times.format(now));
        long runId = preallocatedRunId == null ? repository.insertRun(spaceId, Times.format(now)) : preallocatedRunId;
        // 滚动清理：缓存与去重台账保留期可由配置控制，避免表无限增长
        int purgedCache = repository.purgeExpiredCache(spaceId,
                Times.format(now.minus(Duration.ofDays(properties.getCacheRetentionDays()))));
        int purgedSeen = repository.purgeOldSeen(spaceId,
                Times.format(now.minus(Duration.ofDays(properties.getSeenRetentionDays()))));
        if (purgedCache + purgedSeen > 0) {
            log.info("简报数据清理: 过期缓存 {} 条，过期去重记录 {} 条", purgedCache, purgedSeen);
        }

        List<SourceReportEntry> report = new ArrayList<>();
        int checked = 0;
        int included = 0;
        long fetchDoneMs = 0;
        long enrichDoneMs = 0;
        long qualityDoneMs = 0;
        int qualityDowngraded = 0;
        try {
            Map<String, SourceFetch> fetched = fetchAll(spaceId, properties.getPerSource());
            checked = fetched.values().stream().mapToInt(result -> result.items().size()).sum();
            fetchDoneMs = System.currentTimeMillis();
            runProgress.stage(spaceId, "briefing", runId, "enriching", checked, checked);
            if (runProgress.isCancelled(spaceId, "briefing", runId)) {
                return cancelledRun(runId, checked, spaceId, now, startedMillis);
            }

            Set<String> seen = repository.seenUrls(spaceId);
            Set<String> batchUrls = new LinkedHashSet<>();
            List<String> newUrls = new ArrayList<>();
            List<String> failures = new ArrayList<>();
            List<String> skipped = new ArrayList<>();
            List<IncludedItem> includedItems = new ArrayList<>();
            List<java.util.Set<String>> seenFingerprints = new ArrayList<>();
            int semanticDuplicates = 0;
            for (BriefingSource source : registry.sourcesInOrder()) {
                if (properties.isSkipped(source.id())) {
                    // 已知不可达（反爬）：不请求、不计失败、不影响 status
                    report.add(new SourceReportEntry(source.id(), true, 0, SKIPPED_REASON, true));
                    skipped.add(source.name() + "：" + SKIPPED_REASON);
                    continue;
                }
                String cooling = sourceHealth.coolingReason(spaceId, source.id());
                if (cooling != null) {
                    report.add(new SourceReportEntry(source.id(), true, 0, cooling, true));
                    skipped.add(source.name() + "：" + cooling);
                    continue;
                }
                SourceFetch result = fetched.getOrDefault(source.id(),
                        new SourceFetch(source, List.of(), false, "未抓取到结果"));
                int sourceCount = 0;
                for (RawItem raw : result.items()) {
                    String url = BriefingUrls.normalize(raw.url());
                    if (!BriefingUrls.isHttpUrl(url) || !batchUrls.add(url) || seen.contains(url)) {
                        continue;
                    }
                    String title = BriefingText.clean(raw.title());
                    String summaryText = BriefingText.summary(raw.summary());
                    var fingerprint = DEDUPER.fingerprint(title + " " + summaryText);
                    if (properties.isSemanticDedupe()) {
                        int match = findCluster(fingerprint, seenFingerprints);
                        if (match >= 0) {
                            // 跨源近重复：不再丢弃，合并成一条并记下印证数 + 来源链接
                            includedItems.set(match, includedItems.get(match).corroborated(source.name(), url));
                            semanticDuplicates++;
                            newUrls.add(url);
                            continue;
                        }
                    }
                    seenFingerprints.add(fingerprint);
                    includedItems.add(new IncludedItem(source, title, url, summaryText, raw.score(),
                            sourceCount + 1, raw.publishedAt(), raw.comments(), raw.topComment()));
                    sourceCount++;
                    newUrls.add(url);
                    if (sourceCount >= properties.getPerSource()) {
                        break;
                    }
                }
                included += sourceCount;
                report.add(new SourceReportEntry(result.source().id(), result.ok(), result.items().size(),
                        result.error()));
                if (!result.ok()) {
                    failures.add(result.source().name() + "：" + result.error());
                }
                log.debug("简报源 {{}}（{{}}）: 取到 {{}} 条，收录 {{}} 条{{}}", result.source().id(),
                        result.source().kind(), result.items().size(), sourceCount,
                        result.ok() ? "" : "，失败：" + result.error());
            }
            if (semanticDuplicates > 0) {
                long clusters = includedItems.stream().filter(item -> item.corroboration() > 1).count();
                log.info("简报跨源去重: 合并 {} 条近重复到 {} 个簇（印证数 >1）", semanticDuplicates, clusters);
            }

            Map<String, BriefingEnricher.Enrichment> enrichments = enrich(spaceId, userId, includedItems);
            enrichDoneMs = System.currentTimeMillis();
            runProgress.stage(spaceId, "briefing", runId, "quality_ai", includedItems.size(), includedItems.size());
            if (runProgress.isCancelled(spaceId, "briefing", runId)) {
                return cancelledRun(runId, checked, spaceId, now, startedMillis);
            }
            List<BriefingRenderer.Block> blocks = buildBlocks(includedItems, enrichments);
            // 质量闸门只评分与降级，不删条目：正文完整性优先（P1 明确边界）
            Map<String, QualityResult> quality = scoreIncludedItems(spaceId, includedItems, enrichments);
            // 条目明细只写新表，note 正文格式完全不变
            persistItems(runId, spaceId, includedItems, enrichments, quality);
            qualityDoneMs = System.currentTimeMillis();
            qualityDowngraded = (int) quality.values().stream().filter(result -> !result.accepted()).count();
            runProgress.stage(spaceId, "briefing", runId, "rendering", includedItems.size(), includedItems.size());
            if (runProgress.isCancelled(spaceId, "briefing", runId)) {
                return cancelledRun(runId, checked, spaceId, now, startedMillis);
            }

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
            runProgress.finish(spaceId, "briefing", runId, "done".equals(status) ? "done" : status);
            recordMetrics(spaceId, runId, status, startedMillis, fetchDoneMs, enrichDoneMs, qualityDoneMs,
                    checked, included, qualityDowngraded);
            log.info("简报完成: trigger={} space={} status={} new={} checked={} note={} 失败源={}/{} 耗时={}ms"
                            + " runId={} module=briefing items={} qualityDowngraded={} aiCalls={} tokens={}",
                    trigger, spaceId, status, included, checked, note.id(), failed, attempted,
                    System.currentTimeMillis() - startedMillis, runId, included, qualityDowngraded,
                    analysis.usage().calls(), analysis.usage().promptTokens() + analysis.usage().completionTokens());
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
            runProgress.finish(spaceId, "briefing", runId, "failed");
            recordMetrics(spaceId, runId, "failed", startedMillis, fetchDoneMs, enrichDoneMs, qualityDoneMs,
                    checked, included, qualityDowngraded);
            log.warn("简报失败: trigger={{}} space={{}} 原因={{}}", trigger, spaceId, message, e);
            return new BriefingRunResponse(runId, "failed", checked, included, null, report);
        }
    }

    /** 指标写入失败只记 WARN，绝不影响 run 的结果。 */
    private void recordMetrics(long spaceId, long runId, String status, long startedMillis, long fetchDoneMs,
            long enrichDoneMs, long qualityDoneMs, int fetched, int kept, int downgraded) {
        try {
            long now = System.currentTimeMillis();
            long fetchMs = fetchDoneMs > 0 ? fetchDoneMs - startedMillis : 0;
            long enrichMs = enrichDoneMs > fetchDoneMs && fetchDoneMs > 0 ? enrichDoneMs - fetchDoneMs : 0;
            long qualityMs = qualityDoneMs > enrichDoneMs && enrichDoneMs > 0 ? qualityDoneMs - enrichDoneMs : 0;
            long renderMs = qualityDoneMs > 0 ? Math.max(0, now - qualityDoneMs) : 0;
            metrics.save(new com.kb.ops.RunMetrics("briefing", runId, status, now - startedMillis, fetchMs,
                    enrichMs, qualityMs, renderMs, fetched, kept, downgraded,
                    analysis.usage().calls(), analysis.usage().promptTokens(),
                    analysis.usage().completionTokens(), metrics.estimatedCost(analysis.usage()),
                    Times.format(Instant.now(clock))), spaceId);
        } catch (RuntimeException e) {
            log.warn("简报指标写入失败（不影响生成）: run={} {}", runId, e.toString());
        }
    }

    /** 协作式取消：不打断在途请求，但后续阶段全部跳过，run 标记为 cancelled。 */
    private BriefingRunResponse cancelledRun(long runId, int checked, long spaceId, Instant now, long startedMillis) {
        repository.finishRun(runId, Times.format(now), "cancelled", null, checked, 0, "[]", "用户取消");
        runProgress.finish(spaceId, "briefing", runId, "cancelled");
        recordMetrics(spaceId, runId, "cancelled", System.currentTimeMillis() - startedMillis,
                0, 0, 0, checked, 0, 0);
        log.info("简报已取消: run={} space={}", runId, spaceId);
        return new BriefingRunResponse(runId, "cancelled", checked, 0, null, List.of());
    }

    /** 多源并行（虚拟线程）：只抓不在 skip-sources 里的源；单源失败只影响自己。 */
    private Map<String, SourceFetch> fetchAll(long spaceId, int perSource) {
        List<BriefingFetcher> fetchers = registry.all().stream()
                .filter(fetcher -> !properties.isSkipped(fetcher.source().id()))
                .filter(fetcher -> sourceHealth.coolingReason(spaceId, fetcher.source().id()) == null)
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
                long started = System.currentTimeMillis();
                boolean ok = false;
                try {
                    results.put(source.id(), new SourceFetch(source, futures.get(index).get(
                            budget.toSeconds(), TimeUnit.SECONDS), true, null));
                    ok = true;
                } catch (TimeoutException e) {
                    futures.get(index).cancel(true);
                    results.put(source.id(), new SourceFetch(source, List.of(), false,
                            "超时 " + budget.toSeconds() + "s 无响应"));
                } catch (ExecutionException e) {
                    results.put(source.id(), new SourceFetch(source, List.of(), false, describe(e.getCause())));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    results.put(source.id(), new SourceFetch(source, List.of(), false, "抓取被中断"));
                } finally {
                    sourceHealth.record(spaceId, source.id(), ok, System.currentTimeMillis() - started);
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
            int ordinal, String publishedAt, Integer comments, int corroboration, List<String> sourceLinks,
            String topComment) {

        IncludedItem(BriefingSource source, String title, String url, String summary, Integer score,
                int ordinal, String publishedAt, Integer comments, String topComment) {
            this(source, title, url, summary, score, ordinal, publishedAt, comments, 1, List.of(), topComment);
        }

        /** 近重复合并：印证数 +1，并记下新发现的来源链接。 */
        IncludedItem corroborated(String sourceName, String url) {
            List<String> links = new ArrayList<>(sourceLinks);
            links.add(sourceName + "|" + url);
            return new IncludedItem(source, title, url, summary, score, ordinal, publishedAt, comments,
                    corroboration + 1, links, topComment);
        }
    }

    /** 找与候选指纹近重复的第一个已有簇；找不到返回 -1。 */
    private static int findCluster(java.util.Set<String> candidate,
            List<java.util.Set<String>> fingerprints) {
        for (int index = 0; index < fingerprints.size(); index++) {
            if (DEDUPER.isNearDuplicate(candidate, List.of(fingerprints.get(index)))) {
                return index;
            }
        }
        return -1;
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

    /**
     * 对「富化后的最终文本」评分：这样坏译文、模板摘要都能被抓到。
     * 结果落 content_quality 供报告查询；低分条目仍留在正文，只在未来的「今日必读」里排除。
     */
    private Map<String, QualityResult> scoreIncludedItems(long spaceId, List<IncludedItem> items,
            Map<String, BriefingEnricher.Enrichment> enrichments) {
        Map<String, QualityResult> results = new LinkedHashMap<>();
        if (!qualityProperties.isEnabled() || items.isEmpty()) {
            return results;
        }
        List<String> priors = new ArrayList<>();
        String now = Times.format(Instant.now(clock));
        int downgraded = 0;
        for (IncludedItem item : items) {
            BriefingEnricher.Enrichment enrichment = enrichments.getOrDefault(item.url(),
                    BriefingEnricher.Enrichment.EMPTY);
            String title = enrichment.displayTitle() == null || enrichment.displayTitle().isBlank()
                    ? item.title() : enrichment.displayTitle();
            String summary = enrichment.displaySummary() == null || enrichment.displaySummary().isBlank()
                    ? item.summary() : enrichment.displaySummary();
            QualityResult result = qualityGate.evaluate(new QualityInput(title, summary, List.copyOf(priors)));
            results.put(item.url(), result);
            priors.add(summary == null ? "" : summary);
            qualityRepository.save(spaceId, "briefing", item.url(), result, now);
            if (!result.accepted()) {
                downgraded++;
                log.debug("简报条目降级保留: {} score={} reasons={}", item.url(), result.score(),
                        result.reasons());
            }
        }
        log.info("简报质量闸门: 检查 {} 条，降级保留 {} 条，必读候选 {} 条",
                items.size(), downgraded, items.size() - downgraded);
        return results;
    }

    /** 写入条目明细（Top5/主题/反馈用的新表）。AI 失败或个性化失败都只留空字段，不影响简报。 */
    private void persistItems(long runId, long spaceId, List<IncludedItem> items,
            Map<String, BriefingEnricher.Enrichment> enrichments, Map<String, QualityResult> quality) {
        List<IncludedItem> sorted = new ArrayList<>(items);
        sorted.sort((a, b) -> Integer.compare(
                quality.getOrDefault(b.url(), QualityResult.EMPTY).score(),
                quality.getOrDefault(a.url(), QualityResult.EMPTY).score()));
        List<BriefingItem> records = new ArrayList<>();
        for (int index = 0; index < sorted.size(); index++) {
            IncludedItem item = sorted.get(index);
            BriefingEnricher.Enrichment enrichment = enrichments.getOrDefault(item.url(),
                    BriefingEnricher.Enrichment.EMPTY);
            String title = enrichment.displayTitle() == null || enrichment.displayTitle().isBlank()
                    ? item.title() : enrichment.displayTitle();
            String summary = enrichment.displaySummary() == null || enrichment.displaySummary().isBlank()
                    ? item.summary() : enrichment.displaySummary();
            QualityResult qr = quality.getOrDefault(item.url(), QualityResult.EMPTY);
            AnalysisResult analyzed = analysis.analyze(spaceId, "briefing", item.url(),
                    new AnalysisRequest(title, summary, item.source().id())).orElse(null);
            String theme = BriefingTheme.classify(analyzed == null ? List.of() : analyzed.tags(), title, summary);
            Engagement engagement = new Engagement(
                    item.score() == null ? 0 : item.score(),
                    item.comments() == null ? 0 : item.comments(), item.corroboration());
            records.add(new BriefingItem(runId, item.url(), title, summary, item.source().id(), theme,
                    qr.score(), qr.accepted(), index + 1,
                    analyzed == null ? List.of() : analyzed.keyPoints(),
                    analyzed == null ? null : analyzed.whyItMatters(),
                    personalizer.relatedTitles(spaceId, title),
                    engagement.weight(), engagement.level(), item.corroboration(), item.sourceLinks(),
                    item.topComment()));
        }
        itemRepository.saveAll(spaceId, records);
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

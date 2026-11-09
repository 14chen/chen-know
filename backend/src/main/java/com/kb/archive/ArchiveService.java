package com.kb.archive;

import com.kb.common.ApiException;
import com.kb.common.Times;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.WeekFields;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 归档：把旧的周目录与简报笔记搬进归档子目录。<b>只搬家（改 parent_id / folder_id），绝不删除、
 * 绝不进回收站。</b>
 *
 * <ul>
 *   <li>周目录 {@code 开源周报/2026-W43} → {@code 开源周报/归档/2026-W43}（ISO 周早于「最近 N 周」）</li>
 *   <li>简报笔记（标题 {@code AI 简报 YYYY-MM-DD}）→ {@code AI简报归档/YYYY-MM/}（日期早于 M 天前）</li>
 *   <li>目标目录不存在就自动创建；重名目录复用；目标已有同名笔记 → 不搬也不报错（WARN + skipped）</li>
 *   <li>整个搬迁在一个事务里，搬完校验笔记总数不变，对不上就回滚</li>
 * </ul>
 */
@Service
public class ArchiveService {

    private static final Logger log = LoggerFactory.getLogger(ArchiveService.class);

    /** 简报标题里的日期。 */
    static final Pattern BRIEFING_TITLE = Pattern.compile("^AI\\s*简报\\s*(\\d{4}-\\d{2}-\\d{2}).*$");

    private final ArchiveProperties properties;
    private final ArchiveRepository repository;
    private final TransactionTemplate transactions;
    private final Clock clock;

    /** spaceId → 正在跑（并发保护）。 */
    private final Set<Long> running = ConcurrentHashMap.newKeySet();

    public ArchiveService(ArchiveProperties properties, ArchiveRepository repository,
            TransactionTemplate transactions, Clock clock) {
        this.properties = properties;
        this.repository = repository;
        this.transactions = transactions;
        this.clock = clock;
    }

    public record Result(long runId, int movedFolders, int movedNotes, int skipped, String status) {
    }

    public Result run(long spaceId) {
        if (!properties.isEnabled()) {
            log.info("归档未启用（kb.archive.enabled=false），跳过");
            return new Result(0L, 0, 0, 0, "disabled");
        }
        if (!running.add(spaceId)) {
            throw ApiException.conflict("已有归档任务在运行，请稍后重试");
        }
        long startedMillis = System.currentTimeMillis();
        String startedAt = Times.now();
        long runId = repository.insertRun(spaceId, startedAt);
        try {
            Result result = transactions.execute(status -> doRun(spaceId));
            Result done = new Result(runId, result.movedFolders(), result.movedNotes(), result.skipped(),
                    "success");
            repository.finishRun(runId, Times.now(), "success", done.movedFolders(), done.movedNotes(),
                    done.skipped(), null);
            log.info("归档完成: 周目录 {} 个、简报 {} 篇、跳过 {} 个，耗时 {}ms", done.movedFolders(),
                    done.movedNotes(), done.skipped(), System.currentTimeMillis() - startedMillis);
            return done;
        } catch (RuntimeException e) {
            String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            repository.finishRun(runId, Times.now(), "failed", 0, 0, 0, message);
            log.warn("归档失败（已回滚，未改动任何数据）: {}", message, e);
            return new Result(runId, 0, 0, 0, "failed");
        } finally {
            running.remove(spaceId);
        }
    }

    /** 真正的搬迁；在事务里跑，末尾校验笔记总数不变。 */
    private Result doRun(long spaceId) {
        LocalDate today = LocalDate.now(clock.withZone(ZoneOffset.UTC));
        int notesBefore = repository.countNotes(spaceId);
        List<String> skippedReasons = new ArrayList<>();
        int[] counters = new int[3];                        // movedFolders, movedNotes, skipped

        int movedFolders = archiveWeeklyFolders(spaceId, today, counters, skippedReasons);
        int movedNotes = archiveBriefings(spaceId, today, counters, skippedReasons);

        verifyNoteCount(notesBefore, repository.countNotes(spaceId));
        if (!skippedReasons.isEmpty()) {
            log.warn("归档跳过的对象: {}", skippedReasons);
        }
        return new Result(0L, movedFolders, movedNotes, counters[2], "success");
    }

    /**
     * 搬迁前后笔记总数必须一致；不一致就抛异常，由外层事务整批回滚
     * （宁可什么都不搬，也不能悄悄丢数据）。
     */
    static void verifyNoteCount(int before, int after) {
        if (before != after) {
            throw new IllegalStateException("归档校验失败：笔记总数 " + before + " → " + after
                    + "（搬迁不得改变数量），已整批回滚");
        }
    }

    /** 周目录：ISO 周早于「最近 N 周」的搬到 {@code 开源周报/归档/}。 */
    int archiveWeeklyFolders(long spaceId, LocalDate today, int[] counters, List<String> skippedReasons) {
        Optional<ArchiveRepository.Folder> root =
                repository.childFolderByName(spaceId, null, properties.getWeeklyFolder());
        if (root.isEmpty()) {
            return 0;
        }
        LocalDate currentWeekStart = today.with(WeekFields.ISO.dayOfWeek(), 1);
        LocalDate cutoff = currentWeekStart.minusWeeks(properties.getWeeklyKeepWeeks());
        List<ArchiveRepository.Folder> candidates = repository.childFolders(spaceId, root.get().id())
                .stream()
                .filter(folder -> ArchiveWeek.isOlderThan(folder.name(), cutoff))
                .toList();
        if (candidates.isEmpty()) {
            return 0;
        }
        long archiveId = ensureFolder(spaceId, root.get().id(), properties.getWeeklyArchiveFolder());
        int moved = 0;
        for (ArchiveRepository.Folder folder : candidates) {
            if (repository.childFolderByName(spaceId, archiveId, folder.name()).isPresent()) {
                counters[2]++;                              // 目标已有同名目录 → 幂等跳过
                skippedReasons.add("周目录 " + folder.name() + "（归档里已存在同名目录）");
                continue;
            }
            if (repository.moveFolder(spaceId, folder.id(), archiveId, Times.now()) != 1) {
                throw new IllegalStateException("搬迁周目录失败: " + folder.name());
            }
            moved++;
        }
        counters[0] = moved;
        return moved;
    }

    /** 简报笔记：日期早于 M 天前的搬到 {@code AI简报归档/YYYY-MM/}。 */
    int archiveBriefings(long spaceId, LocalDate today, int[] counters, List<String> skippedReasons) {
        List<ArchiveRepository.NoteBrief> briefings =
                repository.notesByTitlePrefix(spaceId, "AI 简报");
        LocalDate cutoff = today.minusDays(properties.getBriefingKeepDays());
        int moved = 0;
        for (ArchiveRepository.NoteBrief note : briefings) {
            Matcher matcher = BRIEFING_TITLE.matcher(note.title());
            if (!matcher.matches()) {
                continue;
            }
            LocalDate date;
            try {
                date = LocalDate.parse(matcher.group(1));
            } catch (RuntimeException e) {
                continue;                                   // 标题里的日期不合法：不猜
            }
            if (!date.isBefore(cutoff)) {
                continue;                                   // 还不够旧
            }
            long monthFolder = ensureFolder(spaceId, ensureFolder(spaceId, null,
                    properties.getBriefingArchiveFolder()), String.format("%04d-%02d", date.getYear(),
                    date.getMonthValue()));
            if (note.folderId() != null && note.folderId() == monthFolder) {
                continue;                                   // 已在归档目录 → 幂等
            }
            if (repository.noteTitleExistsInFolder(spaceId, monthFolder, note.title(), note.id())) {
                counters[2]++;
                skippedReasons.add("简报《" + note.title() + "》（目标目录已有同名笔记）");
                continue;
            }
            if (repository.moveNote(spaceId, note.id(), monthFolder, Times.now()) != 1) {
                throw new IllegalStateException("搬迁简报失败: " + note.title());
            }
            moved++;
        }
        counters[1] = moved;
        return moved;
    }

    /** 按名字找直接子目录，没有就建（多层自动创建）。 */
    private long ensureFolder(long spaceId, Long parentId, String name) {
        Optional<ArchiveRepository.Folder> existing =
                repository.childFolderByName(spaceId, parentId, name);
        if (existing.isPresent()) {
            return existing.get().id();
        }
        String now = Times.now();
        return repository.createFolder(spaceId, parentId, name, now);
    }

    public List<ArchiveRepository.Run> recent(long spaceId, int limit) {
        return repository.recent(spaceId, limit);
    }

    /** 定时任务用：对<b>所有空间</b>各跑一次归档（单个空间失败不影响其他空间）。 */
    public void runIfDue(String reason) {
        if (!properties.isEnabled()) {
            log.debug("归档开关关闭，跳过 {}", reason);
            return;
        }
        List<Long> spaceIds = repository.allSpaceIds();
        int ok = 0;
        int failed = 0;
        for (Long spaceId : spaceIds) {
            try {
                Result result = run(spaceId);
                if ("success".equals(result.status())) {
                    ok++;
                } else {
                    failed++;
                }
            } catch (RuntimeException e) {
                failed++;
                log.warn("空间 {} 归档失败（{}）: {}", spaceId, reason, e.getMessage());
            }
        }
        log.info("归档任务结束（{}）: 空间 {} 个，成功 {}，失败 {}", reason, spaceIds.size(), ok, failed);
    }
}

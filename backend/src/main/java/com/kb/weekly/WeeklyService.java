package com.kb.weekly;

import com.kb.briefing.BriefingText;
import com.kb.briefing.TranslationClient;
import com.kb.common.ApiException;
import com.kb.common.Times;
import com.kb.folder.CreateFolderRequest;
import com.kb.folder.FolderRepository;
import com.kb.folder.FolderRow;
import com.kb.folder.FolderService;
import com.kb.note.CreateNoteRequest;
import com.kb.note.NoteDetail;
import com.kb.note.NoteService;
import com.kb.user.SpaceRepository;
import com.kb.user.UserAccount;
import com.kb.user.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.WeekFields;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 开源周报：GitHub 周趋势 + Gitee 推荐榜各取前 N，每个项目一篇中文笔记，
 * 归档到 {@code 开源周报/<ISO 周>} 子目录。
 *
 * <ul>
 *   <li>GitHub 有官方「本周新增」，直接用</li>
 *   <li>Gitee 拿不到官方周增 → 用 {@code repo_star_snapshots} 里 7 天前最接近的快照算差值；
 *       首次收录显示「—（首次收录，下周起显示）」，<b>绝不编造数字</b></li>
 *   <li>Gitee 数据文件缺失/过期 → 只跳过 Gitee 并在笔记里如实写明，任务整体仍成功</li>
 * </ul>
 */
@Service
public class WeeklyService {

    private static final Logger log = LoggerFactory.getLogger(WeeklyService.class);

    private final WeeklyProperties properties;
    private final GitHubTrendingClient gitHubClient;
    private final GitHubRepoApi gitHubApi;
    private final GiteeWeeklyReader giteeReader;
    private final RepoStarSnapshots snapshots;
    private final WeeklyRepository repository;
    private final NoteService noteService;
    private final FolderService folderService;
    private final FolderRepository folderRepository;
    private final TranslationClient translation;
    private final ReadmeFetcher readmeFetcher;
    private final UserRepository userRepository;
    private final SpaceRepository spaceRepository;
    private final Clock clock;

    /** spaceId → 正在跑：同一空间并发第二个请求直接 409。 */
    private final Set<Long> running = ConcurrentHashMap.newKeySet();

    public WeeklyService(WeeklyProperties properties, GitHubTrendingClient gitHubClient,
            GitHubRepoApi gitHubApi,
            GiteeWeeklyReader giteeReader, RepoStarSnapshots snapshots, WeeklyRepository repository,
            NoteService noteService, FolderService folderService, FolderRepository folderRepository,
            TranslationClient translation, ReadmeFetcher readmeFetcher, UserRepository userRepository,
            SpaceRepository spaceRepository, Clock clock) {
        this.properties = properties;
        this.gitHubClient = gitHubClient;
        this.gitHubApi = gitHubApi;
        this.giteeReader = giteeReader;
        this.snapshots = snapshots;
        this.repository = repository;
        this.noteService = noteService;
        this.folderService = folderService;
        this.folderRepository = folderRepository;
        this.translation = translation;
        this.readmeFetcher = readmeFetcher;
        this.userRepository = userRepository;
        this.spaceRepository = spaceRepository;
        this.clock = clock;
    }

    /** @param notes 每篇笔记的 id 与标题（便于前端/验收展示） */
    public record RunResponse(long runId, String isoWeek, String status, int notesCreated,
            int notesSkipped, List<NoteRef> notes, String githubNote, String giteeNote) {
    }

    public record NoteRef(long id, String title, String repo, String url, Integer weeklyStars) {
    }

    public RunResponse run(long userId, long spaceId) {
        if (!properties.isEnabled()) {
            throw ApiException.forbidden("周报功能已关闭（kb.weekly.enabled=false），已拒绝执行，未发起任何外网请求");
        }
        if (!running.add(spaceId)) {
            throw ApiException.conflict("本周报任务正在运行，请稍后重试");
        }
        try {
            return execute(userId, spaceId);
        } finally {
            running.remove(spaceId);
        }
    }

    /** 定时任务与启动补抓共用：同一个 ISO 周已经成功跑过就跳过。 */
    public void runIfDue(String reason) {
        if (!properties.isEnabled()) {
            log.debug("周报开关关闭，跳过 {}", reason);
            return;
        }
        String owner = properties.getOwner();
        if (owner == null || owner.isBlank()) {
            log.debug("未配置 kb.weekly.owner，跳过 {}", reason);
            return;
        }
        UserAccount user = userRepository.findByUsername(owner.trim()).orElse(null);
        if (user == null) {
            log.warn("kb.weekly.owner={} 在库里不存在，跳过 {}", owner, reason);
            return;
        }
        Long spaceId = spaceRepository.findIdByOwner(user.id()).orElse(null);
        if (spaceId == null) {
            log.warn("账号 {} 没有空间，跳过 {}", owner, reason);
            return;
        }
        String isoWeek = currentIsoWeek();
        if (repository.hasRunForWeek(spaceId, isoWeek)) {
            log.debug("{}：{} 已有周报，跳过", reason, isoWeek);
            return;
        }
        try {
            RunResponse response = run(user.id(), spaceId);
            log.info("周报自动运行完成（{}）: {} status={} 笔记={}", reason, response.isoWeek(),
                    response.status(), response.notesCreated());
        } catch (ApiException e) {
            log.info("周报自动运行跳过（{}）: {}", reason, e.getMessage());
        } catch (RuntimeException e) {
            log.warn("周报自动运行失败（{}）: {}", reason, e.getMessage(), e);
        }
    }

    private RunResponse execute(long userId, long spaceId) {
        long startedMillis = System.currentTimeMillis();
        Instant now = Instant.now(clock);
        String isoWeek = currentIsoWeek(now);
        String startedAt = Times.format(now);
        long runId = repository.insert(spaceId, isoWeek, startedAt);

        List<WeeklyRepo> github = new ArrayList<>();
        List<WeeklyRepo> gitee = new ArrayList<>();
        String githubNote = null;
        String giteeNote = null;
        int created = 0;
        try {
            try {
                github = gitHubApi.withUpdatedAt(gitHubClient.fetchTrending().stream()
                        .limit(properties.getPerSource()).toList());
                if (github.isEmpty()) {
                    githubNote = "GitHub 趋势页解析出 0 条（页面结构可能变化）";
                }
            } catch (RuntimeException e) {
                githubNote = "GitHub 抓取失败：" + e.getMessage();
                log.warn("GitHub 抓取失败: {}", e.getMessage());
            }
            GiteeWeeklyReader.Result giteeResult = giteeReader.read();
            giteeNote = giteeResult.note();
            gitee = withWeeklyDeltas(spaceId, giteeResult.items().stream()
                    .limit(properties.getPerSource()).toList(), now);

            Long rootId = ensureFolder(spaceId, null, properties.getFolder());
            Long weekId = ensureFolder(spaceId, rootId, isoWeek);

            List<WeeklyRepo> all = new ArrayList<>(github);
            all.addAll(gitee);
            List<String> descriptions = all.stream()
                    .map(repo -> translateDescription(repo.description()))
                    .toList();

            // 先判重再抓 README：只有这次真的要新建的条目才发外网请求，重复运行不再抓。
            NoteRef[] notes = new NoteRef[all.size()];
            int skipped = 0;
            List<Integer> pending = new ArrayList<>();
            for (int index = 0; index < all.size(); index++) {
                WeeklyRepo repo = all.get(index);
                String title = titleOf(repo);
                // 同一 ISO 周重复运行不产生重复笔记（按「周目录 + 标题」判重）
                Optional<Long> existing = weekId == null ? Optional.empty()
                        : repository.findNoteId(spaceId, weekId, title);
                if (existing.isPresent()) {
                    skipped++;
                    notes[index] = new NoteRef(existing.get(), title, repo.repo(), repo.url(),
                            repo.weeklyStars());
                } else {
                    pending.add(index);
                }
            }

            Map<String, ReadmeFetcher.Result> readmes = pending.isEmpty() || !properties.isTutorialEnabled()
                    ? Map.of()
                    : readmeFetcher.fetchAll(pending.stream().map(all::get).toList());

            for (int index : pending) {
                WeeklyRepo repo = all.get(index);
                String title = titleOf(repo);
                String tutorial = tutorialOf(repo, descriptions.get(index), readmes.get(ReadmeFetcher.key(repo)));
                String content = WeeklyNoteContent.render(repo, isoWeek, descriptions.get(index),
                        rankOf(index, github.size()), tutorial);
                NoteDetail note = noteService.create(userId, spaceId,
                        new CreateNoteRequest(weekId, title, content));
                List<String> tags = properties.getTags();
                if (tags != null && !tags.isEmpty()) {
                    noteService.setTags(spaceId, note.id(), tags);
                }
                notes[index] = new NoteRef(note.id(), note.title(), repo.repo(), repo.url(),
                        repo.weeklyStars());
                created++;
            }
            List<NoteRef> ordered = new ArrayList<>(notes.length);
            for (NoteRef ref : notes) {
                if (ref != null) {
                    ordered.add(ref);
                }
            }
            recordSnapshots(spaceId, github, gitee, notGithub(all, github), now);

            String status = decideStatus(github, gitee);
            String error = "failed".equals(status) ? combineNotes(githubNote, giteeNote) : null;
            repository.finish(runId, Times.format(Instant.now(clock)), status, created, skipped,
                    github.size(), gitee.size(), error);
            log.info("周报完成: {} status={} GitHub={} Gitee={} 新笔记={} 已存在跳过={} 耗时={}ms", isoWeek,
                    status, github.size(), gitee.size(), created, skipped,
                    System.currentTimeMillis() - startedMillis);
            return new RunResponse(runId, isoWeek, status, created, skipped, ordered, githubNote, giteeNote);
        } catch (RuntimeException e) {
            String message = e.getMessage() == null || e.getMessage().isBlank()
                    ? e.getClass().getSimpleName() : e.getMessage();
            try {
                repository.finish(runId, Times.format(Instant.now(clock)), "failed", created, 0,
                        github.size(), gitee.size(), message);
            } catch (RuntimeException ignored) {
                // 落库失败不再掩盖原始异常
            }
            log.warn("周报失败: {} 原因={}", isoWeek, message, e);
            return new RunResponse(runId, isoWeek, "failed", created, 0, List.of(), githubNote, giteeNote);
        }
    }

    /** GitHub 有官方周增；Gitee 用「本次 - 7 天前最接近快照」。 */
    private List<WeeklyRepo> withWeeklyDeltas(long spaceId, List<WeeklyRepo> repos, Instant now) {
        String sevenDaysAgo = Times.format(now.minusSeconds(properties.getSnapshotLookbackDays() * 86400L));
        List<WeeklyRepo> out = new ArrayList<>(repos.size());
        for (WeeklyRepo repo : repos) {
            Optional<Long> previous = snapshots.starsAtOrBefore(spaceId, repo.source(), repo.repo(),
                    sevenDaysAgo);
            Integer delta = previous.map(before -> (int) Math.max(0L, repo.stars() - before)).orElse(null);
            out.add(new WeeklyRepo(repo.source(), repo.repo(), repo.url(), repo.stars(), delta,
                    repo.language(), repo.description(), repo.updatedAt()));
        }
        return out;
    }

    /** 本次运行先写快照（下周起就能算出真实周增）。 */
    private void recordSnapshots(long spaceId, List<WeeklyRepo> github, List<WeeklyRepo> gitee,
            List<WeeklyRepo> extras, Instant now) {
        String capturedAt = Times.format(now);
        for (WeeklyRepo repo : github) {
            snapshots.record(spaceId, repo.source(), repo.repo(), repo.stars(), capturedAt);
        }
        for (WeeklyRepo repo : gitee) {
            snapshots.record(spaceId, repo.source(), repo.repo(), repo.stars(), capturedAt);
        }
        for (WeeklyRepo repo : extras) {
            snapshots.record(spaceId, repo.source(), repo.repo(), repo.stars(), capturedAt);
        }
    }

    private static List<WeeklyRepo> notGithub(List<WeeklyRepo> all, List<WeeklyRepo> github) {
        return all.stream()
                .filter(repo -> !"github".equalsIgnoreCase(repo.source()))
                .filter(repo -> github.stream().noneMatch(item -> item.repo().equals(repo.repo())))
                .toList();
    }

    private static String titleOf(WeeklyRepo repo) {
        return "[" + repo.sourceLabel() + "] " + repo.repo();
    }

    private static int rankOf(int index, int githubCount) {
        return index < githubCount ? index + 1 : index - githubCount + 1;
    }

    /** 教程失败绝不影响周报：降级成「给个地址」，再不行就整段省略。 */
    private String tutorialOf(WeeklyRepo repo, String descriptionZh, ReadmeFetcher.Result readme) {
        try {
            if (readme == null) {
                return RepoTutorial.renderUnavailable(repo, "本次未抓取 README");
            }
            if (readme.ok()) {
                return RepoTutorial.render(repo, descriptionZh, readme.url(), readme.markdown(),
                        properties.getTutorialMaxLines());
            }
            return RepoTutorial.renderUnavailable(repo, readme.reason());
        } catch (RuntimeException e) {
            log.debug("教程生成失败（跳过教程）: {} ({})", repo.repo(), e.getMessage());
            return null;
        }
    }

    private String translateDescription(String description) {
        if (description == null || description.isBlank()) {
            return "";
        }
        if (BriefingText.looksChinese(description)) {
            return description;
        }
        try {
            String zh = translation.translate(description);
            return zh == null || zh.isBlank() ? description : zh;
        } catch (RuntimeException e) {
            log.debug("描述翻译失败（保留原文）: {} ({})", BriefingText.truncate(description, 30), e.getMessage());
            return description;
        }
    }

    /** 按名字找目录，没有就自动建（周报是按周分目录，必须自动建）。 */
    private Long ensureFolder(long spaceId, Long parentId, String name) {
        if (name == null || name.isBlank()) {
            return parentId;
        }
        String wanted = name.trim();
        for (FolderRow folder : folderRepository.listAlive(spaceId)) {
            if (folder.name().equals(wanted) && java.util.Objects.equals(folder.parentId(), parentId)) {
                return folder.id();
            }
        }
        return folderService.create(spaceId, new CreateFolderRequest(parentId, wanted)).id();
    }

    static String decideStatus(List<WeeklyRepo> github, List<WeeklyRepo> gitee) {
        boolean hasGithub = !github.isEmpty();
        boolean hasGitee = !gitee.isEmpty();
        if (hasGithub && hasGitee) {
            return "success";
        }
        if (hasGithub || hasGitee) {
            return "partial";
        }
        return "failed";
    }

    private static String combineNotes(String githubNote, String giteeNote) {
        List<String> parts = new ArrayList<>(2);
        if (githubNote != null) {
            parts.add(githubNote);
        }
        if (giteeNote != null) {
            parts.add(giteeNote);
        }
        return String.join("；", parts);
    }

    /** 当前 ISO 周，形如 {@code 2026-W44}。 */
    String currentIsoWeek() {
        return currentIsoWeek(Instant.now(clock));
    }

    static String currentIsoWeek(Instant instant) {
        LocalDate date = LocalDate.ofInstant(instant, ZoneOffset.UTC);
        int week = date.get(WeekFields.ISO.weekOfWeekBasedYear());
        int year = date.get(WeekFields.ISO.weekBasedYear());
        return String.format("%d-W%02d", year, week);
    }

    public List<WeeklyRepository.Run> recent(long spaceId, int limit) {
        return repository.recent(spaceId, limit);
    }
}

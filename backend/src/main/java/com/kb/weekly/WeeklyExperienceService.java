package com.kb.weekly;

import com.kb.analysis.AnalysisRequest;
import com.kb.analysis.AnalysisResult;
import com.kb.analysis.StructuredAnalysisService;
import com.kb.briefing.BriefingTheme;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.WeekFields;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/** 周报体验：写入周档案/项目档案，提供总览、星增序列、Top3 解读。note 正文格式不动。 */
@Service
public class WeeklyExperienceService {

    private final WeeklyExperienceRepository repository;
    private final StructuredAnalysisService analysis;

    public WeeklyExperienceService(WeeklyExperienceRepository repository, StructuredAnalysisService analysis) {
        this.repository = repository;
        this.analysis = analysis;
    }

    /** 在 WeeklyService 写完快照后调用；只写新表，不影响笔记或 run 状态。 */
    public void write(long spaceId, String isoWeek, List<WeeklyRepo> repos, List<WeeklyService.NoteRef> notes,
            String now) {
        Map<String, WeeklyService.NoteRef> byRepo = notes.stream()
                .collect(Collectors.toMap(WeeklyService.NoteRef::repo, Function.identity(), (a, b) -> a));
        int rank = 0;
        for (WeeklyRepo repo : repos) {
            WeeklyService.NoteRef ref = byRepo.get(repo.repo());
            if (ref == null) continue;
            rank++;
            String theme = BriefingTheme.classify(null, repo.description(), repo.language());
            repository.insertWeek(spaceId, isoWeek, repo.source(), repo.repo(), ref.title(), ref.id(),
                    ref.url(), (int) repo.stars(), repo.weeklyStars(), repo.language(), rank, theme, now,
                    repo.openIssues(), repo.forks());
            WeeklyExperienceRepository.Profile previous = repository.profile(spaceId, repo.source(), repo.repo())
                    .orElse(null);
            int consecutive = previous == null ? 1
                    : isoWeek.equals(previousIsoWeek(previous.lastSeenWeek()))
                            ? previous.consecutiveWeeks() + 1 : 1;
            repository.upsertProfile(spaceId, repo.source(), repo.repo(), isoWeek, consecutive,
                    repo.weeklyStars(), now);
        }
    }

    /** 每次周报运行开始时重置 AI 分析预算。 */
    public void beginRun() {
        analysis.beginRun();
    }

    public List<WeeklyExperienceRepository.WeekRow> weeks(long spaceId) {
        return repository.weeks(spaceId);
    }

    public record Highlight(WeeklyExperienceRepository.ProjectWeek project, List<String> keyPoints,
            String whyItMatters, String risks, boolean aiGenerated) {
    }

    public record WeekDetail(String isoWeek, List<WeeklyExperienceRepository.ProjectWeek> projects,
            List<Highlight> highlights, Map<String, Integer> themes) {
    }

    public WeekDetail weekDetail(long spaceId, String isoWeek) {
        List<WeeklyExperienceRepository.ProjectWeek> projects = repository.weekProjects(spaceId, isoWeek);
        List<Highlight> highlights = projects.stream()
                .sorted(Comparator.comparing((WeeklyExperienceRepository.ProjectWeek p) ->
                        p.weeklyStars() == null ? Integer.MIN_VALUE : p.weeklyStars()).reversed())
                .limit(3)
                .map(project -> highlight(spaceId, project))
                .toList();
        Map<String, Integer> themes = projects.stream()
                .collect(Collectors.groupingBy(WeeklyExperienceRepository.ProjectWeek::theme, Collectors.summingInt(x -> 1)));
        return new WeekDetail(isoWeek, projects, highlights, themes);
    }

    private Highlight highlight(long spaceId, WeeklyExperienceRepository.ProjectWeek project) {
        AnalysisResult analyzed = analysis.analyze(spaceId, "weekly", project.source() + ":" + project.repo(),
                new AnalysisRequest(project.title(), project.theme() + " " + project.source(), project.source()))
                .orElse(null);
        if (analyzed != null) {
            return new Highlight(project, analyzed.keyPoints(), analyzed.whyItMatters(),
                    analyzed.risks().isEmpty() ? null : String.join("；", analyzed.risks()), true);
        }
        // 规则兜底：只用真实字段，不写「AI 生成」误导用户
        List<String> points = new java.util.ArrayList<>();
        if (project.weeklyStars() != null) points.add("本周新增 " + project.weeklyStars() + " 颗星");
        points.add("总星 " + project.totalStars() + "，位于 " + project.source() + " 榜第 " + project.rank() + " 名");
        if (project.openIssues() != null) points.add("开放 issue / PR " + project.openIssues() + " 个");
        if (project.forks() != null) points.add("fork " + project.forks() + " 次");
        if (project.language() != null && !project.language().isBlank()) points.add("主要语言：" + project.language());
        String why = project.weeklyStars() == null
                ? "首次进入榜单，基线建立中；下周起可看真实周增。"
                : "增长明显高于同批项目，值得先看它的实现思路。";
        return new Highlight(project, points, why, null, false);
    }

    /** ISO 周字符串（2026-W47）的前一周。 */
    static String previousIsoWeek(String isoWeek) {
        try {
            LocalDate date = LocalDate.parse(isoWeek + "-1", DateTimeFormatter.ISO_WEEK_DATE).minusWeeks(1);
            WeekFields fields = WeekFields.ISO;
            return String.format(Locale.ROOT, "%d-W%02d", date.get(fields.weekBasedYear()),
                    date.get(fields.weekOfWeekBasedYear()));
        } catch (RuntimeException e) {
            return "";
        }
    }
}

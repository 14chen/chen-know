package com.kb.activity;

import com.kb.common.ApiException;
import com.kb.common.Times;
import com.kb.user.KbPrincipal;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** API.md §9：浏览动态（activities）与统计。 */
@Service
public class ActivityService {

    /** 与 {@code activities.action} 的 CHECK 约束保持一致。 */
    public static final String ACTION_VIEW = "view";
    public static final String ACTION_RESTORE = "restore";
    public static final String ACTION_IMPORT = "import";
    public static final String ACTION_EXPORT = "export";
    public static final String ACTION_DELETE = "delete";

    /** {@code dailyCreated} 固定 14 天（含今天）。 */
    static final int DAILY_WINDOW_DAYS = 14;
    private static final int MAX_RECENT_LIMIT = 100;

    private final ActivityRepository activities;

    public ActivityService(ActivityRepository activities) {
        this.activities = activities;
    }

    /** 记一次浏览。必须先校验归属与存活，再写日志（避免用日志探测他人笔记）。 */
    public void recordView(KbPrincipal principal, long noteId) {
        if (!activities.isAliveNoteInSpace(noteId, principal.spaceId())) {
            throw ApiException.notFound("笔记不存在");
        }
        activities.insert(principal.id(), noteId, ACTION_VIEW, Times.now());
    }

    /** 供回收站/导入导出模块复用。{@code noteId} 可为 null（操作级行为，如导入整包）。 */
    public void record(long userId, Long noteId, String action) {
        activities.insert(userId, noteId, action, Times.now());
    }

    public RecentResponse recent(KbPrincipal principal, int limit) {
        int capped = Math.max(1, Math.min(limit, MAX_RECENT_LIMIT));
        return new RecentResponse(activities.recentViews(principal.id(), principal.spaceId(), capped));
    }

    public StatsResponse stats(KbPrincipal principal) {
        long spaceId = principal.spaceId();
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        String from = today.minusDays(DAILY_WINDOW_DAYS - 1L).toString();

        // 8 条独立 COUNT 合并成一次聚合查询（DEF-E3-003）：1 万篇时代价从 ~140ms 降到毫秒级
        ActivityRepository.StatsAggregate agg = activities.spaceStats(spaceId, today.toString(), from);
        Map<String, Long> byDate = agg.createdByDate();
        List<StatsResponse.DailyCreated> dailyCreated = new ArrayList<>(DAILY_WINDOW_DAYS);
        for (int offset = DAILY_WINDOW_DAYS - 1; offset >= 0; offset--) {
            String date = today.minusDays(offset).toString();
            dailyCreated.add(new StatsResponse.DailyCreated(date, byDate.getOrDefault(date, 0L)));
        }

        return new StatsResponse(
                agg.noteCount(),
                agg.folderCount(),
                agg.tagCount(),
                agg.attachmentCount(),
                agg.totalAttachmentBytes(),
                agg.trashCount(),
                agg.updatedToday(),
                dailyCreated);
    }
}

package com.kb.briefing;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * BRIEFING.md §5：{@code kb.briefing.*} 配置。
 *
 * <ul>
 *   <li>{@code enabled} 总开关</li>
 *   <li>{@code owner} 归档到哪个账号（定时任务与启动补抓用；POST /run 用调用者自己的空间）</li>
 *   <li>{@code cron} 定时表达式，默认每天 18:30</li>
 *   <li>{@code per-source} 每个源最多收录几条（默认 5）</li>
 *   <li>{@code folder} 归档目录名（按名字找现有目录，找不到就不进目录，不自动建）</li>
 *   <li>{@code tags} 归档笔记的标签</li>
 *   <li>{@code skip-sources} 已知不可达（反爬）的源，默认 {@code importai}：不请求、不计失败</li>
 *   <li>{@code hour}/{@code minute} 可选：cron 不是「分 时」这种简单写法的显式兜底，仅供启动补抓判断时刻</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "kb.briefing")
public class BriefingProperties {

    private boolean enabled = true;
    private String owner = "";
    private String cron = "0 30 18 * * *";
    private int perSource = 5;
    private String folder = "";
    private List<String> tags = new ArrayList<>(List.of("AI简报"));
    /** 已知不可达（反爬）的源 id：不发请求、不计失败、不影响 status，但仍出现在源清单里。 */
    private List<String> skipSources = new ArrayList<>(List.of("importai"));
    /** 是否把英文标题/摘要翻成中文。 */
    private boolean translate = true;
    /** 翻译提供方：auto（默认，有 key 走 DeepL 否则 MyMemory）/ deepl / mymemory / none。 */
    private String translateProvider = "auto";
    /** DeepL key（免费版以 :fx 结尾）；留空则 auto 落到 MyMemory。 */
    private String deeplKey = "";
    /** 显式覆盖 DeepL 端点（一般留空，由 key 后缀决定 free/paid）。 */
    private String deeplEndpoint = "";
    /** 是否抓文章页（拿更充实的摘要 + 首图）。 */
    private boolean fetchArticle = true;
    /** 单次运行最多下载几张配图。 */
    private int maxImages = 20;
    private Integer hour;
    private Integer minute;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getOwner() {
        return owner;
    }

    public void setOwner(String owner) {
        this.owner = owner;
    }

    public String getCron() {
        return cron;
    }

    public void setCron(String cron) {
        this.cron = cron;
    }

    public int getPerSource() {
        return perSource <= 0 ? 5 : perSource;
    }

    public void setPerSource(int perSource) {
        this.perSource = perSource;
    }

    public String getFolder() {
        return folder;
    }

    public void setFolder(String folder) {
        this.folder = folder;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags == null ? new ArrayList<>() : new ArrayList<>(tags);
    }

    public List<String> getSkipSources() {
        return skipSources;
    }

    public void setSkipSources(List<String> skipSources) {
        this.skipSources = skipSources == null ? new ArrayList<>() : new ArrayList<>(skipSources);
    }

    /** @param sourceId 源 id（如 {@code importai}） */
    public boolean isSkipped(String sourceId) {
        if (sourceId == null) {
            return false;
        }
        String wanted = sourceId.trim().toLowerCase(Locale.ROOT);
        return skipSources.stream()
                .filter(value -> value != null)
                .map(value -> value.trim().toLowerCase(Locale.ROOT))
                .anyMatch(wanted::equals);
    }

    public boolean isTranslate() {
        return translate;
    }

    public void setTranslate(boolean translate) {
        this.translate = translate;
    }

    public String getTranslateProvider() {
        return translateProvider;
    }

    public void setTranslateProvider(String translateProvider) {
        this.translateProvider = translateProvider;
    }

    public String getDeeplKey() {
        return deeplKey;
    }

    public void setDeeplKey(String deeplKey) {
        this.deeplKey = deeplKey;
    }

    public String getDeeplEndpoint() {
        return deeplEndpoint;
    }

    public void setDeeplEndpoint(String deeplEndpoint) {
        this.deeplEndpoint = deeplEndpoint;
    }

    public boolean isFetchArticle() {
        return fetchArticle;
    }

    public void setFetchArticle(boolean fetchArticle) {
        this.fetchArticle = fetchArticle;
    }

    public int getMaxImages() {
        return maxImages < 0 ? 0 : maxImages;
    }

    public void setMaxImages(int maxImages) {
        this.maxImages = maxImages;
    }

    public Integer getHour() {
        return hour;
    }

    public void setHour(Integer hour) {
        this.hour = hour;
    }

    public Integer getMinute() {
        return minute;
    }

    public void setMinute(Integer minute) {
        this.minute = minute;
    }

    /**
     * 「今天的生成时刻」：优先从 {@code cron} 的前两个字段（分、时）解析，
     * 解析不出来（例如 {@code *\/5} 这种）再用显式 {@code hour}/{@code minute}，最后退回 18:30。
     */
    public LocalTime dueTime() {
        int[] clock = parseSimpleClock(cron);
        if (clock != null) {
            return LocalTime.of(clock[0], clock[1]);
        }
        int resolvedHour = hour == null ? 18 : hour;
        int resolvedMinute = minute == null ? 30 : minute;
        return LocalTime.of(Math.floorMod(resolvedHour, 24), Math.floorMod(resolvedMinute, 60));
    }

    /**
     * 从 cron 里读出「几点几分」。
     *
     * <p>Spring 的 {@code @Scheduled(cron=...)} 是 <b>6 段</b>（秒 分 时 日 月 周），
     * 例如默认值 {@code 0 30 18 * * *} = 18:30；也兼容 5 段的 unix 写法（分 时 日 月 周）。
     *
     * @return {@code {hour, minute}}；任一段不是纯数字（如 {@code *\/30}）时返回 null，由调用方回退
     */
    static int[] parseSimpleClock(String expression) {
        if (expression == null) {
            return null;
        }
        String[] parts = expression.trim().split("\\s+");
        int minuteIndex;
        int hourIndex;
        if (parts.length >= 6) {
            minuteIndex = 1;
            hourIndex = 2;
        } else if (parts.length == 5) {
            minuteIndex = 0;
            hourIndex = 1;
        } else {
            return null;
        }
        try {
            int parsedMinute = Integer.parseInt(parts[minuteIndex]);
            int parsedHour = Integer.parseInt(parts[hourIndex]);
            if (parsedMinute < 0 || parsedMinute > 59 || parsedHour < 0 || parsedHour > 23) {
                return null;
            }
            return new int[] {parsedHour, parsedMinute};
        } catch (NumberFormatException e) {
            return null;
        }
    }
}

package com.kb.weekly;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code kb.weekly.*}：开源周报（GitHub + Gitee 每周 star 涨最快）配置。
 */
@ConfigurationProperties(prefix = "kb.weekly")
public class WeeklyProperties {

    private boolean enabled = true;
    /** 归档到哪个账号（定时任务与启动补抓用；POST /run 用调用者自己的空间）。 */
    private String owner = "";
    private String cron = "0 30 18 * * FRI";
    private int perSource = 5;
    /** 顶级目录名，下面再按 ISO 周建子目录。 */
    private String folder = "开源周报";
    private List<String> tags = new ArrayList<>(List.of("开源周报"));
    /** Gitee 数据文件（脚本产出）；相对路径按 kb.data-dir 的父目录解析。 */
    private String giteeJson = "data/weekly-gitee.json";
    /** 快照最多回溯多少天；超过就认定「没有 7 天前的快照」。 */
    private int snapshotLookbackDays = 7;
    /** GitHub API 基址（给入选仓库补 pushed_at）；留空用默认 api.github.com。 */
    private String githubApiBase = "https://api.github.com";

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

    public String getGiteeJson() {
        return giteeJson;
    }

    public void setGiteeJson(String giteeJson) {
        this.giteeJson = giteeJson;
    }

    public String getGithubApiBase() {
        return githubApiBase;
    }

    public void setGithubApiBase(String githubApiBase) {
        this.githubApiBase = githubApiBase;
    }

    public int getSnapshotLookbackDays() {
        return snapshotLookbackDays <= 0 ? 7 : snapshotLookbackDays;
    }

    public void setSnapshotLookbackDays(int snapshotLookbackDays) {
        this.snapshotLookbackDays = snapshotLookbackDays;
    }
}

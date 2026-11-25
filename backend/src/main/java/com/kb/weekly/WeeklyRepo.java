package com.kb.weekly;

/**
 * 周报里的一个项目。
 *
 * @param source {@code github} / {@code gitee}
 * @param repo 形如 {@code owner/name}
 * @param url 完整仓库地址（Gitee 的中文 owner 已做百分号编码）
 * @param stars 总星
 * @param weeklyStars 本周新增（GitHub 用官方数字；Gitee 用快照差值，首次收录为 null → 表格里整行省略）
 * @param language 语言（可能为 null）
 * @param description 原始描述（可能是英文，需要翻译）
 * @param updatedAt 最近更新时间的原始串（GitHub 的 relative-time datetime / Gitee 脚本换算的日期），可能为空
 * @param openIssues 开放 issue 数（GitHub API 的 open_issues_count，含开放 PR；拿不到为 null）
 * @param forks fork 数（GitHub API 的 forks_count；拿不到为 null）
 */
public record WeeklyRepo(String source, String repo, String url, long stars, Integer weeklyStars,
        String language, String description, String updatedAt, Integer openIssues, Integer forks) {

    /** 兼容不带更新时间/互动数的调用。 */
    public WeeklyRepo(String source, String repo, String url, long stars, Integer weeklyStars,
            String language, String description) {
        this(source, repo, url, stars, weeklyStars, language, description, null, null, null);
    }

    /** 兼容带更新时间、还没有互动数的调用。 */
    public WeeklyRepo(String source, String repo, String url, long stars, Integer weeklyStars,
            String language, String description, String updatedAt) {
        this(source, repo, url, stars, weeklyStars, language, description, updatedAt, null, null);
    }

    public String sourceLabel() {
        return "gitee".equalsIgnoreCase(source) ? "Gitee" : "GitHub";
    }
}

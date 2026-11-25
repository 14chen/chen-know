# 内容质量：真实互动量排序、跨源印证与社区原话

> 2026-11-23。借鉴 `mvanhorn/last30days-skill` 的核心主张：**用「多少人真的在意」判断重要性，而不是「哪个源发的」**。
> 全部用纯 Java 增量实现，不引入 Python 运行时；note / 周报笔记正文格式完全不变，所有增强落在网页视图与新表。

## 决策与边界

- **note 正文冻结**：`BriefingRenderer` 的五段式、`importance()` 的星级规则、周报笔记排版均不改动。「重要级别」在网页视图里由「热度」徽标独立表达。
- **信号只用原生数字**：HN points、HN 评论数、GitHub `open_issues_count`（含开放 PR）、`forks_count`、跨源印证数。不引入主观源权重，拿不到就留空，不编造。
- **重复不再丢弃**：原先 P2 的 `SemanticDeduper` 近重复直接 `continue`；现在合并成一条，记录 `corroboration_count` 与来源链接。正文条目数与之前「开启去重」时一致。

## 热度算法（`com.kb.briefing.Engagement`）

```
weight = score + comments * 2 + max(0, corroboration - 1) * 50
level  = weight >= 300 ? 3 : weight >= 100 ? 2 : 1
```

- 评论按点赞 2 倍计权（讨论比点赞稀缺）；
- 第 2 个起的每个独立印证来源 +50；
- 负数入参归零；`level` 只用于网页徽标配色。

## 数据落点

| 表 | 新增列 | 含义 |
| --- | --- | --- |
| `briefing_items` | `engagement` / `engagement_level` | HN points + 评论×2 + 印证加分及分档 |
| `briefing_items` | `corroboration_count` / `source_links` | 同一事件被几个源报道；`来源名\|URL` 的 JSON 数组 |
| `briefing_items` | `top_quote` | HN 最高赞评论原文（去 HTML、截断 160 字） |
| `weekly_project_weeks` | `open_issues` / `forks` | GitHub 开放 issue/PR 数与 fork 数，拿不到为 NULL |

迁移全部走 `SchemaMigrator.ensureColumn`，老库幂等补列。

## 行为变化（用户可见）

- **简报「今日必读」Top5**：仍是质量分 ≥ 70 的候选，但改为按 `engagement` 倒序；卡片新增「热度 N」「N 个来源报道」徽标。
- **简报详情抽屉**：新增「社区高赞原话」引用行与「多源印证」链接列表（仅 http(s) 链接可点，带 `noopener noreferrer`）。
- **周报 Top3**：卡片与详情显示「开放 issue/PR N · fork N」，规则兜底解读也引用这些真实数字。
- **HN 抓取**：`num_comments` 作为互动信号；对热度最高的最多 3 条故事额外请求 `/api/v1/items/{id}` 取最高赞评论，失败静默降级（不阻断条目）。

## 不做的事

- 不接 last30days 的 20+ 社交源（需 API key / 浏览器 Cookie / 付费 key，不适合多租户自托管 KB）。
- 不把 last30days 当 Java 库调用（它是独立 Python CLI + 自己的 SQLite）。
- 不改 `BriefingRenderer.importance()`；「源身份星级」继续只服务 note 正文。

## 验证

- 后端单测/集成测试：443/443（`EngagementTest`、`HackerNewsFetcherTest`、`BriefingApiTest`、`GitHubRepoApiTest`、`WeeklyApiTest` 新增 10 项）。
- 前端：`tsc -b` 0 错误；mock 套件 A 92/92、B 72/72。
- 真实应用（隔离数据目录）：简报 31 条新内容，HN 条目热度 2247/1843/1410…，3 条高赞原话落库；周报 10 篇笔记，Top3 显示 209/24/50 个 issue 与 2850/6466/882 次 fork。
- 截图：`docs/images/engagement/{01-briefing-top5,02-briefing-drawer-quote,03-weekly-top3}.png`。

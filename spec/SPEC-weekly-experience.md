# Spec: 开源周报体验升级（weekly-experience）— V1

> 依赖：`quality-gate`、`ai-analysis`（运行时可选）、`briefing-experience` 的前端模式。
> P1 最后一个模块。

## Objective

把开源周报从「10 篇模板笔记 + 一个只能看最新周的卡片页」升级为「有观点、有趋势、能回看」的周报：

- 一份**总览**（Top10 排名 + 真实星增趋势 + 主题分布 + 连续上榜）
- **Top3 深度解读**（为什么现在值得看 / 适合谁 / 风险，AI 可用时用 AI，否则用规则+真实数据）
- **项目档案**跨周积累（首次上榜、连续周数、星增加速度）
- 前端支持**切换历史周**、星增图表、主题筛选、详情

## Tech Stack

- Java 21 + Spring Boot 4.1 + JdbcTemplate（沿用）
- React 19 + TypeScript；趋势图用**内联 SVG**，不引入图表库
- 不新增运行时依赖

## Commands

```
cd backend && .\mvnw.cmd -B -Dtest=WeeklyProjectProfileTest,WeeklyTrendApiTest test
cd frontend && node node_modules\typescript\bin\tsc -b --pretty false
cd backend && .\mvnw.cmd -B test
```

## Project Structure

```
backend/src/main/java/com/kb/weekly/
    WeeklyProjectProfile.java / WeeklyProjectProfileRepository.java
    StarTrendService.java     # 从 repo_star_snapshots 算真实周增/加速度/榜位变化
    WeeklyInsightService.java # Top3 解读：AI 优先，规则兜底
    WeeklyExperienceController.java  # weeks / week detail / trend / profile
backend/src/main/java/com/kb/db/SchemaMigrator.java  # 追加 weekly_project_profiles
frontend/src/views/weekly/index.tsx                  # 周选择器 + 趋势 + Top3 + 详情
frontend/src/styles/views-weekly.css
```

## API 契约（新增，错误格式沿用 `{error:{code,message}}`）

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/weekly/weeks` | 历史 ISO 周列表 `[{isoWeek, projectCount, generatedAt}]` |
| `GET` | `/api/weekly/week/{isoWeek}` | 某周总览：`{isoWeek, projects:[WeeklyProjectView], highlights:[Top3], themes:[...]}` |
| `GET` | `/api/weekly/repos/{source}/{repo}/stars?weeks=8` | 星增序列 `[{capturedAt, stars, delta}]`，用于 sparkline |
| `GET` | `/api/weekly/profiles?source=&repo=` | 项目档案（首次上榜、连续周数、历史星增） |

`WeeklyProjectView`：`{source, repo, title, noteId, url, totalStars, weeklyStars, language, rank, theme, trend, insight, isNew}`。

## 规则与算法

- **星增**：取同一 `(space_id, source, repo)` 相邻两次快照之差；窗口内无前序快照则 `weeklyStars=null`、`isNew=true`，显示「新进榜 · 基线建立中」，**不编数字**。
- **加速度**：本周 delta − 上周 delta；只有两周都有真实 delta 时才显示。
- **主题**：复用 `BriefingTheme.classify`（README 描述 + 语言）。
- **Top3 解读**：按质量分（真实星增 + 排名 + 活跃度）取前 3；有 AI 分析时用其结构化结果，否则用真实字段拼规则文案，不写「AI 生成」误导用户。

## Boundaries

- **Always**：不编造星增；无快照就显示基线中；所有查询按 `space_id` 隔离；旧周数据只读不改。
- **Ask first**：新增/删除用户笔记、改变现有笔记格式、把内容发外部 AI。
- **Never**：因图表/解读失败让周报页白屏；把「存量最热」冒充「本周新增」。

## Success Criteria

1. 现有 10 篇周报笔记**完全不动**（若下面的确认项选择「不改 note」）。
2. 新 API 能列出所有 ISO 周并回看任意一周，不再只能看最新周。
3. 星增来自真实相邻快照；首次收录明确标注「新进榜」，不显示假数字。
4. `weekly_project_profiles` 跨周积累：首次上榜周、连续上榜周数、历史最高周增。
5. Top3 解读有「为什么值得看 / 适合谁 / 风险」三类字段（AI 或规则兜底）。
6. 前端：周选择器、星增 sparkline（内联 SVG）、主题筛选、项目详情抽屉；四断点无溢出、零 console 错误。
7. 全量测试与构建通过。

## Out of Scope (Deferred)

- 邮件/Webhook 推送、订阅、跨库对比
- 真正的 Gitee trending（当前源仍是站内搜索的存量热度，保持诚实标注）
- 重写历史周报笔记或补写教程（用户此前选择不回溯）

## Open Questions（已全部确认 2026-11-22）

1. **不改现有 10 篇周报笔记**：总览 / Top3 / 趋势只在 `#/weekly` 网页视图展示；不新增、不回溯笔记。
2. **Top3 解读**：AI 优先，无 AI 时用真实字段拼规则文案，不写「AI 生成」误导。
3. **星增口径**：真实相邻快照差 + 加速度；首次收录显示「新进榜 · 基线建立中」，不编数字。
4. **趋势图**：内联 SVG sparkline，不引入图表库。

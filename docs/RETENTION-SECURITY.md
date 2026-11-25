# 数据保留与安全加固（P2 / retention-security）

> 规格：`spec/SPEC-retention-security.md`。清理任务默认开启，每天 04:30 只清元数据表。

## 保留策略

| 表 | 默认保留 | 配置键 |
|---|---|---|
| `briefing_cache` | 90 天 | `kb.retention.cache-days` |
| `briefing_seen` | 180 天 | `kb.retention.seen-days` |
| `run_metrics` / `run_progress` | 90 天 | `kb.retention.metrics-days` |
| `source_health` | 90 天 | `kb.retention.health-days` |
| `content_quality` / `ai_analysis` | 90 天 | `kb.retention.quality-days` / `ai-days` |
| `repo_star_snapshots` / `weekly_project_weeks` / `weekly_project_profiles` | 400 天 | `kb.retention.weekly-days` |

**绝不删除**：任何 `notes`、目录、附件、归档笔记、`briefing_runs` / `weekly_runs` 历史行。
`RetentionService.clean(dryRun)` 可先统计再删；定时任务只调用 `clean(false)`。

## 语义去重

`SemanticDeduper` 用标题+摘要的 5-gram Jaccard（阈值 0.85）判跨源近重复，命中条目**直接丢弃**（不入简报、不写 seen），日志记录丢弃数；`kb.briefing.semantic-dedupe` 可关闭。

## 安全加固

- 简报正文的 `链接：` 行改为 `<url>` 形式，剥掉尖括号与控制字符。
- `BriefingUrls.isPublicHttpUrl` 先做字符串判断（含八进制/十六进制 IP 写法），再解析实际 IP 判断回环/私网/链路本地；每次重定向后重新校验。DNS 层校验默认开启（`kb.security.ssrf-dns-check`），测试用假域名可关闭。
- 本地 Ollama 的 `localhost` 仍可用于 AI `base-url`（抓取源不受此豁免）。
- `MiniJson` 解析深度上限 64；`\uXXXX` 正确合并 UTF-16 代理对。

# Spec: 运行可观测性（observability）— P2 V1

> 依赖：`spec/SPEC-run-lifecycle.md`（已实现）。下游：`source-health`、`retention-security`。

## Objective

让「跑得怎么样」有数据可查，而不是靠翻日志猜：每次 run 记录阶段耗时、条目数、质量淘汰数、AI 调用与 token；提供只读 ops 端点看成功率、耗时分位数与成本；日志保持一行 INFO 但带可解析指标。

用户价值：
- 简报/周报偶发失败时，能立刻看到是哪个阶段慢、哪个源挂了、AI 花了多少。
- 源健康自治与数据保留策略后续可以直接消费这些指标，不需要再埋点。

## Tech Stack

- Java 21 + Spring Boot 4.1 + JdbcTemplate
- 不新增依赖；token 统计从 OpenAI-compatible 响应的 `usage` 字段解析
- 分位数在 Java 中计算（最近 N 条 run，无 SQL 窗口函数）

## Commands

```
cd backend && .\mvnw.cmd -B -Dtest=RunMetricsApiTest test
cd backend && .\mvnw.cmd -B test
```

## Project Structure

```
backend/src/main/java/com/kb/ops/
    RunMetrics.java / RunMetricsRepository.java     # 新表 run_metrics
    RunMetricsService.java                          # 记录 + 聚合（成功率/p50/p95/成本）
    OpsController.java                              # /api/ops/runs、/api/ops/summary
backend/src/main/java/com/kb/analysis/
    AnalysisUsage.java                              # token 用量（从 usage 解析）
    OpenAiCompatibleAnalysisClient.java             # 解析 usage（失败不影响结果）
backend/src/main/java/com/kb/db/SchemaMigrator.java # run_metrics DDL
docs/OBSERVABILITY.md
```

## 指标字段

`run_metrics(space_id, module, run_id, status, total_ms, stage_fetch_ms, stage_enrich_ms, stage_quality_ai_ms, stage_render_ms, items_fetched, items_kept, quality_downgraded, ai_calls, ai_prompt_tokens, ai_completion_tokens, estimated_cost, created_at)`，主键 `(space_id, module, run_id)`。

## API 契约（新增，错误格式沿用 `{error:{code,message}}`）

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/ops/runs?module=&limit=20` | 最近 N 次 run 的指标，按 `space_id` 过滤（管理员可加 `all=true`） |
| `GET` | `/api/ops/summary?module=&days=7` | `{runs, successRate, p50Ms, p95Ms, avgItems, aiCalls, tokens, estimatedCost, sourceHealth}` |

`sourceHealth` 从 `briefing_runs.source_report` / `weekly_runs.error` 聚合，不必新增源表（`source-health` 模块再细化）。

## 成本估算

- 从响应 `usage.prompt_tokens` / `usage.completion_tokens` 累计到当次 run。
- 单价由 `kb.ai.price-input-per-1m` / `kb.ai.price-output-per-1m` 配置，**默认 0** —— 不配置就不报金额，只报 token，避免编造成本。
- 本地 Ollama 无 usage 字段时 token 记 0，不影响其他指标。

## 日志

保留「一次 run 一行 INFO」的传统，追加可解析的 `key=value` 字段（runId/module/status/ms/items/aiCalls/tokens），**不打印正文或外部内容原文**。

## Boundaries

- **Always**：指标写入失败只记 WARN，绝不影响简报/周报生成；所有查询按空间隔离；token/成本没有数据就留 0。
- **Ask first**：跨空间聚合、改变现有 run 表结构、在日志打印内容。
- **Never**：编造成本或 token；把外部源返回的内容当指标；因 ops 查询失败影响业务接口。

## Success Criteria

1. 每次简报/周报 run（同步与异步）都写一条 `run_metrics`，阶段耗时与条目数有真实值。
2. AI 调用的 token 从 `usage` 解析并累计；配置单价后能算出估算成本，未配置时金额为 0。
3. `/api/ops/runs` 与 `/api/ops/summary` 可用，成功率为真实值，p50/p95 由最近 N 条计算。
4. 指标写入失败不影响 run 成功；ops 接口异常不影响业务。
5. 全量测试与构建通过，真实应用 ops 接口返回上一次 run 的真实指标。

## Out of Scope (Deferred)

- 外部时序数据库 / Prometheus 接入、告警规则 → 后续
- 逐源成功率表与自动冷却 → `source-health` 模块
- 数据保留清理任务 → `retention-security` 模块

## Open Questions（待确认）

1. 指标存新表 `run_metrics`（推荐，不动现有表）还是扩展 `briefing_runs`/`weekly_runs`？
2. 成本估算：单价可配置、默认 0（推荐）/ 内置模型价格表 / 只统计 token 不算钱？
3. ops 端点权限：`/api/ops/runs` 只看自己空间、`/api/ops/summary` 管理员可见（推荐）/ 全部管理员 / 全部登录用户？
4. 日志格式：现有一行 INFO 追加 `key=value`（推荐）/ 改 JSON 结构化日志（需调整日志配置）？

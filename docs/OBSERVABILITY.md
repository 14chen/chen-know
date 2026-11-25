# 运行可观测性（P2 / observability）

> 规格：`spec/SPEC-observability.md`。默认只统计 token、不估算金额。

## 指标落点

每次简报/周报 run（同步或异步）都在 `run_metrics` 写一行：
`total_ms`、四阶段耗时（`stage_fetch/enrich/quality_ai/render_ms`）、`items_fetched/kept`、`quality_downgraded`、`ai_calls`、`ai_prompt_tokens`、`ai_completion_tokens`、`estimated_cost`。

指标写入失败只记 WARN，**绝不影响 run 本身**。

## AI 用量与成本

- 从 OpenAI-compatible 响应的 `usage.prompt_tokens` / `usage.completion_tokens` 解析；本地 Ollama 无该字段时记 0。
- 单价由 `kb.ai.price-input-per-1m` / `kb.ai.price-output-per-1m` 配置，**默认 0**（只报 token、不报金额，避免编造成本）。

## 只读 API

| 方法 | 路径 | 权限 |
|---|---|---|
| `GET` | `/api/ops/runs?module=&limit=20&all=true` | 明细只看自己空间；`all=true` 仅管理员生效 |
| `GET` | `/api/ops/summary?module=&days=7` | 仅管理员；聚合全部空间 |

`summary` 返回 `{runs, successRate, p50Ms, p95Ms, avgItems, aiCalls, tokens, estimatedCost, sourceHealth}`；
`successRate = (success + partial) / runs`，分位数由最近 N 条指标在 Java 中计算。

## 日志

保留「一次 run 一行 INFO」的传统，并追加可解析字段：`runId=… module=… items=… qualityDowngraded=… aiCalls=… tokens=…`，不打印正文或外部内容原文。

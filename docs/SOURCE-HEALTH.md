# 源健康自治（P2 / source-health）

> 规格：`spec/SPEC-source-health.md`。默认：连续失败 5 次 → 冷却 30 分钟；HN 时间窗 7 天。

## 行为

- 每次抓取记录成功/失败与耗时到 `source_health(space_id, module, source_id, ...)`；延迟保留最近 20 个样本，`p95LatencyMs` 由窗口计算。
- 连续失败 5 次写 `cooldown_until = now + 30min`；冷却期内**不发起请求**，简报正文与源清单标注「冷却中，预计 HH:mm UTC 恢复」。
- 冷却到期后自动试探；成功即清零连续失败并解除冷却。
- 静态 `skip-sources`（如 importai）仍优先，标注「已知不可达」，与健康冷却区分。
- Hacker News 查询追加 `numericFilters=created_at_i>now-7d`，避免按相关性反复返回旧热帖。

## API

`GET /api/ops/sources?module=briefing`：按空间隔离，返回
`{sourceId, name, successCount, failureCount, consecutiveFailures, lastSuccessAt, lastFailureAt, lastLatencyMs, p95LatencyMs, cooldownUntil, state, statusMessage}`；
`state ∈ ok | degraded | cooling | skipped`。

## 边界

- 冷却只跳过请求，不删数据、不改已生成笔记的其它内容。
- 健康记录失败是旁路，绝不影响简报生成。
- 当前按空间隔离，没有跨实例全局熔断。

# Spec: 源健康自治（source-health）— P2 V1

> 依赖：`spec/SPEC-observability.md`（已实现，提供逐源成功/失败统计）。

## Objective

让「哪个源挂了」从翻日志变成有状态、有自动保护：

- 每源记录成功率、最近耗时、连续失败次数、上次成功/失败时间、冷却截止时间。
- 连续失败达到阈值自动进入冷却，**冷却期内不发起请求**；恢复窗口过后自动试探。
- 前端源状态表与简报正文明确标注「冷却中 / 已知不可达」，不再让用户猜为什么某个源一直「—」。
- 修复 HN 无时间窗的问题：Algolia 查询加 `created_at_i` 过滤，避免反复收录旧热帖。

## Tech Stack

- Java 21 + Spring Boot 4.1 + JdbcTemplate（沿用）
- 不新增依赖；耗时在 `BriefingService.fetchAll` 现有 Future 循环中测量

## Commands

```
cd backend && .\mvnw.cmd -B -Dtest=SourceHealthTest test
cd backend && .\mvnw.cmd -B test
cd frontend && node node_modules\typescript\bin\tsc -b --pretty false
```

## Project Structure

```
backend/src/main/java/com/kb/briefing/
    SourceHealth.java / SourceHealthRepository.java   # 新表 source_health
    SourceHealthService.java                          # 记录结果 / 判定冷却 / 查询
backend/src/main/java/com/kb/db/SchemaMigrator.java   # source_health DDL
frontend/src/views/briefing/index.tsx                 # 源状态表显示冷却标记
frontend/src/views/briefing/ItemsPanel.tsx            # 无需改动（条目视图不展示源健康）
docs/SOURCE-HEALTH.md
```

## 表结构

`source_health(space_id, module, source_id, success_count, failure_count, consecutive_failures, last_success_at, last_failure_at, last_latency_ms, p95_latency_ms, cooldown_until, updated_at, PRIMARY KEY(space_id,module,source_id))`

## 行为

1. `fetchAll` 前查所有源健康状态：`cooldown_until > now` 的源跳过抓取，报告里写 `skipped=true` + 「冷却中，预计 HH:mm 恢复」。
2. 每源抓取结束后记录：成功/失败、耗时；成功清零 `consecutive_failures`，失败累加；达到阈值写 `cooldown_until = now + 冷却时长`。
3. 冷却到期后正常发起请求；仍失败则再冷却，成功则恢复。
4. 静态 `skip-sources`（如 importai）仍优先，标注「已知不可达」，与健康冷却区分。
5. HackerNews URL 追加 `numericFilters=created_at_i>now-7d`（可配置天数）。

## API 契约（新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/ops/sources?module=briefing` | 逐源健康列表；普通用户看自己空间，管理员全局（与 ops 既有权限一致） |

字段：`{sourceId, name, successCount, failureCount, consecutiveFailures, lastSuccessAt, lastFailureAt, lastLatencyMs, p95LatencyMs, cooldownUntil, state}`，`state ∈ ok | degraded | cooling | skipped`。

## Boundaries

- **Always**：冷却只跳过请求、不删数据、不改简报 note 正文；健康记录失败不影响抓取；所有查询按空间隔离。
- **Ask first**：把冷却改为永久禁用、改变静态 skip-sources 语义、在正文里隐藏冷却源。
- **Never**：因为健康模块异常让简报生成失败；把「存量最热」的 Gitee 数据当成真实周增。

## Success Criteria

1. 连续失败达到阈值后源进入冷却，期间不发起请求；冷却到期自动恢复。
2. 前端源状态表与简报正文显示「冷却中，预计 X 恢复」；静态 skip 源仍显示「已知不可达」。
3. `/api/ops/sources` 返回真实成功率、p95 延迟、冷却状态。
4. HN 查询带时间窗；新增测试确认 URL 含 `numericFilters`。
5. 全量测试与构建通过，真实应用截图确认冷却标注渲染。

## Out of Scope (Deferred)

- 基于成功率的动态权重排序（属于 `briefing-experience` 的排序增强）
- 跨实例共享的全局熔断（当前按 space 隔离足够）
- 源级关键词/每源条数配置

## Open Questions（已全部确认 2026-11-22）

1. 冷却：**连续失败 5 次 → 冷却 30 分钟**（用户选择）。
2. 展示：正文与源清单都标注「冷却中，预计 X 恢复」，不完全隐藏。
3. 健康数据：新表 `source_health` 逐次记录，支持 p95 延迟。
4. HN 时间窗：7 天，写死为常量（用户选择推荐项）。

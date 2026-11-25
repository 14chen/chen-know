# Spec: 运行生命周期（run-lifecycle）— P2 V1

## Objective

消除「点一下按钮白等 15–40 秒」的体验问题，并让多实例部署下不会再重复跑出两条简报/周报：

- 异步启动：立即返回 `202 + runId`，前端轮询分阶段进度。
- 分阶段进度：抓取 → 富化 → 质量与 AI → 渲染入库，每阶段显示状态与计数。
- 协作式取消：用户可标记取消，正在进行的 HTTP 调用不强制打断，但后续阶段跳过。
- DB 级并发锁：同一空间同时只允许一个 run（多实例也生效）。

## Tech Stack

- Java 21 + Spring Boot 4.1 + JdbcTemplate + Spring `@Async`（或直接 ExecutorService）
- SQLite 部分唯一索引做 run 锁
- React 前端轮询（`setTimeout` 递归 + 指数退避），不引入新依赖

## Commands

```
cd backend && .\mvnw.cmd -B -Dtest=RunLifecycleApiTest test
cd backend && .\mvnw.cmd -B test
cd frontend && node node_modules\typescript\bin\tsc -b --pretty false
```

## Project Structure

```
backend/src/main/java/com/kb/run/
    RunProgress.java / RunProgressRepository.java    # 阶段状态持久化
    RunLauncher.java                                  # 异步编排 + 取消标记
    RunLock.java                                      # DB 级 run 锁
backend/src/main/java/com/kb/db/SchemaMigrator.java   # run_progress 表 + 部分唯一索引
frontend/src/views/briefing/index.tsx / weekly/index.tsx  # 轮询与进度条
```

## API 契约（新增/修改，错误格式沿用 `{error:{code,message}}`）

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/briefing/run?async=true` | → `202 {runId, status:"running"}`；不加参数仍是同步 200（兼容现有验收脚本） |
| `GET` | `/api/briefing/runs/{id}/progress` | `{runId, status, stage, stageLabel, done, total, cancelled, startedAt, finishedAt}` |
| `POST` | `/api/briefing/runs/{id}/cancel` | → `{ok:true}`；协作式取消 |
| 同上 | `/api/weekly/...` | 同语义 |

阶段枚举：`fetching | enriching | quality_ai | rendering | done | failed | cancelled`。

## 并发锁设计

- 在 `briefing_runs` / `weekly_runs` 上加部分唯一索引：
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_briefing_running ON briefing_runs(space_id) WHERE status='running';`
- 启动时把超过 30 分钟的 `running` 标记为 `failed`（已有 `markStaleRunningFailed`），避免锁永久卡死。
- 抢锁失败 → 409（与现有 JVM 内锁行为一致，多实例也生效）。

## Boundaries

- **Always**：同步模式行为不变；取消是协作式的、不打断在途 HTTP；进度查询轻量（单表单行）。
- **Ask first**：把异步改成默认、强制终止在途请求、改变既有 `POST /run` 响应结构。
- **Never**：因为进度/取消功能让简报或周报生成失败；在进度里暴露外部内容的原文。

## Success Criteria

1. 同步 `POST /run` 行为与今天完全一致（现有 420 项测试与验收脚本不破）。
2. `?async=true` 立即返回 202 + runId，后台执行；进度接口能观察到阶段推进。
3. 取消后不再进入后续阶段，run 最终状态为 `cancelled`。
4. 同一空间并发第二个 run（同步或异步）返回 409；多实例下也由 DB 索引保证。
5. 前端在异步模式下显示分阶段进度条，完成后自动刷新列表与外壳数据。
6. 全量测试与构建通过，真实应用截图确认进度条渲染。

## Out of Scope (Deferred)

- 强制中断在途 HTTP 请求（需要请求级 cancellation，复杂度高）
- WebSocket/SSE 推送（轮询足够）
- 分布式任务队列（引入 Redis/Celery 等新依赖）

## Open Questions（待确认）

1. 异步模式保持**可选**（`?async=true`），同步仍是默认，确认吗？
2. 取消采用协作式（标记后跳过后续阶段，不打断在途请求），确认吗？
3. 进度阶段用 4 段（抓取/富化/质量与AI/渲染入库）够吗？
4. DB 锁用部分唯一索引（`WHERE status='running'`）+ 30 分钟僵尸清理，确认吗？

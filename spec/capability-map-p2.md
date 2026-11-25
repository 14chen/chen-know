# Capability Map: 可靠性与可运维（P2）

> 状态：待用户确认模块边界与构建顺序。

| Module id | 职责 | Depends on |
|---|---|---|
| `run-lifecycle` | 异步 run（202 + runId）、分阶段进度、协作式取消、DB 级并发锁 | — |
| `observability` | run 级指标持久化（条数/淘汰数/AI 调用/耗时）、`GET /api/ops/*`、结构化日志 | `run-lifecycle` |
| `source-health` | 每源成功率/延迟/连续失败/冷却，自动降权；HN 时间窗过滤 | `observability` |
| `retention-security` | 缓存/去重表滚动清理、语义去重、URL 转义、SSRF 加固、JSON 解析深度限制 | `observability` |

**构建顺序**：`run-lifecycle` → `observability` → `source-health` → `retention-security`

**依赖方向**：进度与指标先有统一载体，源健康与清理再消费指标；语义去重与 URL/SSRF 加固属于内容入口治理，放在最后统一处理。

**每个模块单独交付**：自己的 spec、测试、验证证据。

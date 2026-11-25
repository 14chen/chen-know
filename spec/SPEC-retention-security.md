# Spec: 数据保留与安全加固（retention-security）— P2 V1

> 依赖：`spec/SPEC-observability.md`、`spec/SPEC-source-health.md`（已实现）。
> P2 最后一个模块。

## Objective

把「长期运行会不会积累垃圾数据」和「外部内容能不能安全进系统」两件事收口：

- 所有临时元数据表有统一、可配置的滚动清理（保留笔记与归档完全不动）。
- 跨源重复内容（同一条新闻被多个源报道）不重复占据 Top 位，但条目仍保留在正文。
- 堵住三个已识别的安全/健壮性缺口：简报 URL 未转义、SSRF 只按点分十进制判断、MiniJson 无深度限制且代理对解析错误。

## Tech Stack

- Java 21 + Spring Boot 4.1 + JdbcTemplate（沿用）
- 不新增依赖；simhash 用 JDK `MessageDigest` + 位运算实现

## Commands

```
cd backend && .\mvnw.cmd -B -Dtest=RetentionServiceTest,SecurityHardeningTest,SemanticDedupeTest test
cd backend && .\mvnw.cmd -B test
```

## Project Structure

```
backend/src/main/java/com/kb/ops/
    RetentionService.java / RetentionScheduler.java   # 统一滚动清理（可配置保留天数）
backend/src/main/java/com/kb/briefing/
    SemanticDeduper.java                              # 跨源近重复（simhash 汉明距离 ≤ 3）
    BriefingUrls.java                                 # SSRF 加固
    BriefingRenderer.java                             # URL 转义
    MiniJson.java                                     # 深度限制 + 代理对修复
backend/src/main/java/com/kb/config/SchedulingConfig.java  # 调度线程池 = 3（已在 properties 配）
docs/RETENTION-SECURITY.md
```

## 清理范围与默认保留期

| 表 | 默认保留 | 说明 |
|---|---|---|
| `briefing_cache` | 90 天 | 已有 TTL；清理任务兜底 |
| `briefing_seen` | 180 天 | 去重台账 |
| `run_metrics` / `run_progress` | 90 天 | 指标与进度 |
| `source_health` | 90 天 | 源健康历史 |
| `content_quality` / `ai_analysis` | 90 天 | 质量与 AI 缓存 |
| `repo_star_snapshots` / `weekly_project_weeks` / `weekly_project_profiles` | 400 天 | 跨周趋势需要较长窗口 |

**绝不删除**：任何 `notes`、目录、附件、归档笔记、`briefing_runs` / `weekly_runs` 历史行。

## 语义去重

- 对每条入选条目计算 simhash（归一化标题 + 摘要的 5-gram 权重），与同批次前序条目比较汉明距离 ≤ 3 判为近重复。
- 近重复条目**直接从本次简报丢弃**（用户 2026-11-22 确认）：不入 `includedItems`、不写 seen、不出现在正文；日志记录丢弃数。
- 与现有 `DuplicateRule`（5-gram Jaccard）互补：Jaccard 在质量层扣分降级，simhash 在入库前跨源去重并丢弃。

## 安全加固

1. **URL 转义**：`BriefingRenderer` 的 `链接：` 行改为 Markdown 安全形式 `<url>`，并对 `<`, `>`, 控制字符做编码；保留绝对 http(s) 校验。
2. **SSRF 加固**：`BriefingUrls.isPublicHttpUrl` 改为先 `InetAddress.getByName()` 解析，再判断解析结果是否内网/回环/链路本地；拒绝八进制/十六进制等非常规 IP 写法；`JdkHttpTransport` 每次重定向后重新校验目标。
3. **MiniJson**：解析深度上限 64（超限抛异常）；`\uXXXX` 正确合并 UTF-16 代理对，避免 emoji/罕用字乱码。

## Boundaries

- **Always**：清理任务默认关闭或低风险时段执行；dry-run 日志先统计条数；所有清理只删元数据表；安全改动不能阻断正常抓取。
- **Ask first**：把清理任务默认打开、删除运行历史、禁止所有内网域名（本地 Ollama 需要 localhost）。
- **Never**：删除用户笔记/附件/归档；因为加固改动让现有源（含本地 Ollama）不可用。

## Success Criteria

1. `RetentionScheduler` 可按配置清理各元数据表，dry-run 输出准确；笔记与 runs 历史数量不变。
2. 跨源近重复条目被直接丢弃，不出现在正文、不写入 seen；日志记录丢弃数。
3. 渲染后的 URL 行不含未转义的 `<`/`>`；新增注入样例测试。
4. SSRF 测试覆盖 `127.0.0.1`、`0177.0.0.1`、`0x7f000001`、IPv6 回环、重定向到内网；本地 Ollama `http://localhost:11434/v1` 仍可用（AI base-url 单独白名单）。
5. MiniJson 深度超限抛异常；代理对样例正确解析。
6. 全量测试与构建通过。

## Out of Scope (Deferred)

- 真正的 DNS rebinding 防护（需要连接层固定 IP，复杂度高）
- 外部威胁情报 / URL 信誉服务
- 用户数据导出与备份策略（属于部署运维）

## Open Questions（已全部确认 2026-11-22）

1. 清理任务**默认开启**（每天 04:30 只清元数据表，不动笔记/运行历史）。
2. 语义去重**直接丢弃**近重复条目（用户选择，不保留在正文）。
3. SSRF：**解析 IP + 每次重定向重校验**，不做连接层固定 IP。
4. 本地 Ollama 的 localhost **单独白名单保留**（抓取源仍封内网；AI base-url 显式配置 localhost 时允许）。

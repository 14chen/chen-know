# 流 A 进展（搜索与数据库层）

环境：实例端口 8531，数据目录 `F:\work\test\kb\d-a`（真实库 `data\kb.db` 与 8080 未触碰）。
实例用私有 classes 副本启动（`evidence/a/run-a.ps1`），避免与其它流并发编译抢 `target/classes`。
证据目录：`docs/test-20261028/evidence/a/`（探针脚本 + before/after JSON + 实例日志）。

## 编译 / 测试

- `kb-build.ps1`：**exit=0**（多次，最后一次在全部改动之后）。只用带锁脚本，未绕过。
- `kb-build.ps1 -Tests`：**328 用例 / 1 失败 / 0 错误**。唯一失败 `TrashApiTest.restoreOnlyBringsBackNotesDeletedWithTheFolder` 不在本流包内（C 流 trash）：该用例连续两次 `Times.now()`（`ISO_INSTANT`，毫秒精度）给"先删的笔记"与"随目录删除"打时间戳，落在同一毫秒时恢复逻辑按同一次删除处理 → expected 0 but was 1；单独跑该类 11/0 通过两轮。连接池让两条语句更相邻，命中概率上升。建议 C 流 trash 侧用严格先后，或测试里隔 1ms。
- 早前出现的 7 个 `JUnit Failed to close extension context`（SchemaMigrationTest / SqliteTransactionModeTest）是本流引入的：池化后 @TempDir 句柄不释放。已改为「生产路径显式池化 + 直接 new 不池化 + destroy/close 关闭空闲连接」，已消失。

## DEF-E3-001（S2）大正文把搜索拖慢 4 倍

改法：
1. `search/SearchRepository`：不再取回 `notes.content` 全文。SQL 里用 `instr(content, 探测词)` 定位首个命中，`substr(..., 命中-40, 400)` 只取窗口（探测词=首个检索词 → 小写形式 → 都没有则取正文开头 400 字）。
2. `search/SearchHighlighter`：高亮不再按全文长度分配 `boolean[]`、不再全文扫描；只对窗口做标记（数组长度 = 窗口长度），HTML 片段与 markdown 摘要共用一次标记。
3. `db/SchemaMigrator`：FTS5 外部内容表（`content='notes'`）三个同步触发器统一按 `kb.db.fts-blob-limit`（默认 32768 字符）截断 `search_blob`；历史超长行一次性 `delete-all` + 截断重建（`PRAGMA user_version=1` 打标）。

验证（5 篇 1MB 正文落在结果页，"无大正文" vs "有大正文"）：

| 指标 | 修前 | 修后 |
|---|---|---|
| rel20 P95 | 272.8 → 625.7 ms（**2.29×**） | 246.9 → 264.3 ms（**1.07×**） |
| upd20 P95 | 252.6 → 251.2 ms | 252.6 → 251.2 ms（0.99×） |
| q=天 size=10 P50 | 266.7 ms | 213.8 ms（无缓存）/ 8.5 ms（命中缓存） |

目标「2MB 正文存在时 P95 差距 ≤30%」达成（≈7%）。证据：`evidence/a/bignote3-before.json`、`bignote3-after.json`、`perf-before.json`、`perf-after2.json`。

## DEF-E3-002（S2）并发搜索塌陷

改法：
1. 每请求一条 FTS 排序查询；结果不满一页时 total = offset+行数（不数），满页才补一条无 bm25、无排序的 COUNT（FTS5 的 `bm25()` 与窗口函数互斥，不能再搭 `COUNT(*) OVER ()`）。
2. 新增 `search/SearchResultCache`：有界 LRU(128) + 3s TTL；失效 = `PRAGMA data_version`（跨连接写）+ `SqliteDataSource.writeEpoch()`（同连接写：用 `total_changes()` 在连接归还时判定）。实测新建/修改/删除后立即搜索均立即可见（`probe-cache-fresh.mjs`：create→1、patch 后同 key 立即 0、新词 1、purge 后 0）。

验证（读多写少混合 15s，含 notes-list/search/tags/stats/detail）：

| 并发 | 修前 rps / P50 / P95 | 修后 rps / P50 / P95 |
|---|---|---|
| 10 | 48.8 / 29.3 / 612.5 ms | **503 / 15.0 / 36.8 ms** |
| 25 | 59.8 / 79.2 / 1233.9 ms | **715 / 22.3 / 45.5 ms** |
| 50 | 61.9 / 289.2 / **2110.9 ms** | **701 / 40.0 / 66.0 ms** |

搜索任务单独看：P50 509.6 / 1082.1 / 1797.3 ms → **13.3 / 25.1 / 50.3 ms**；50 并发 P95 2383.9 → **1309.9 ms**。目标「50 并发 P95 ≤3s」达成（全局 66ms）。证据：`concurrency-before.json` / `concurrency-after.json`。

## DEF-E4-003（S3）3 字中文检索命中但无 `<em>` 高亮

结论：后端确有一处真缺陷（已修），另有前端渲染口径问题（转 F）。
1. 后端：查询「天气很」时 FTS 按逐字短语命中，可匹配原文并不连续的「天气，很好」，旧高亮器只做字面查找 → 无 `<em>`、snippet 为 null。已在 `SearchHighlighter` 增加「汉字按序出现、中间允许非汉字分隔符」的匹配与标记。实测 `天气，很好；天 气 很 好。` 搜「天气很」→ `<em>天气</em>，<em>很</em>好；` ✓
2. 前端：搜索结果正文渲染 `snippet`（纯文本 + `**` → `<strong>`），标题才用 `highlight`（`<em>`）；探针统计 `document.querySelectorAll("em")`，正文命中永远计 0（1/2 字那两次的 em 来自标题）。建议 F 流统一口径（正文也渲染 `<em>`，或统计 `<strong>`）。
证据：`evidence/a/probe-e4003-*.log`（1/2/3/4 字 `highlightHasEm=true`）。

## DEF-E3-005（S3）删大正文后 DB 不回收

改法：
- `db/SchemaMigrator`：建表前把 `auto_vacuum` 设为 `INCREMENTAL`；旧库不是该模式时切换后执行一次 `VACUUM` 生效（一次性，启动期，日志有 before/after）。
- 新增 `db/DatabaseMaintenance`（守护线程，默认 60s）：`wal_checkpoint(TRUNCATE)` → `PRAGMA incremental_vacuum` → 空闲页仍多且距上次 ≥10 分钟则整库 `VACUUM`（实测 incremental_vacuum 在该库每轮只挪得动 1 页，必须 VACUUM 兜底）。另提供显式入口 `reclaimNow()`。参数走系统属性默认值：`kb.db.maintenance`、`kb.db.maintenance-interval-ms`、`kb.db.vacuum-interval-ms`、`kb.db.fts-blob-limit`（无需改 application.properties）。

验证：回收站 26 篇（含 5 篇 1MB 正文）彻底清除后，维护任务 `incremental_vacuum`（空闲页 13462 → 13）+ `VACUUM`：**kb.db 99.14 MB → 46.43 MB**，`kb.db-wal` 46.71 MB → **0**。
证据：`evidence/a/reclaim.log`、`evidence/a/logs/kb-8531.out.log`（`VACUUM 完成：库文件 99 MB -> 46 MB`）。

## DEF-E3-006（S4）每请求新建连接 + 重复下发 PRAGMA

改法：`db/SqliteDataSource` 自实现**有界连接池**（无新依赖）：空闲连接 `ArrayDeque`（上限 16，`kb.db.pool-size`），动态代理把 `close()` 拦成归还；归还前回滚未提交事务并复位 autoCommit；坏连接丢弃重建；PRAGMA 每条物理连接只下一次；`destroy()/close()` 关闭全部空闲连接。`DatabaseConfig` 显式 `new SqliteDataSource(url, true)` 开启池化，单参构造保持"不池化、close 即关"（临时库/单测用）。

验证：

| 接口 | 修前 P50 | 修后 P50 |
|---|---|---|
| GET /api/health（空响应） | 13.5 ms | **9.7 ms** |
| GET /api/tags | 13.1 ms | **8.4 ms** |
| 并发 50 /api/tags P50 | 136.9 ms | **39.0 ms** |
| 并发 50 /api/notes?size=50 P50 | 143.6 ms | **39.2 ms** |

## 追加：C 流所需覆盖索引（lead 指派）

`db/SchemaMigrator` 追加式 DDL 新增 `CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(space_id, deleted_at, created_at)`（幂等）。混合压测里 `/api/stats` 并发 50 P50 1027.4 → 41.6 ms。

## 改动文件清单

- `search/SearchRepository.java`、`search/SearchService.java`、`search/SearchHighlighter.java`、`search/SearchResultCache.java`（新增）
- `db/SqliteDataSource.java`、`db/DatabaseMaintenance.java`（新增）、`db/SchemaMigrator.java`、`db/DatabaseConfig.java`

## 红线

未改 `data\kb.db`、未碰 8080、未改其它流的包 / pom.xml / node_modules / `docs\test-20261027`；实例按 pid 停止、端口释放。

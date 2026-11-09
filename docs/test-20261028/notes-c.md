# 流 C 进展（note / history / link / activity）· 端口 8533 · 数据目录 F:\work\test\kb\d-c

（追加式记录：改了什么、怎么验的）

## 0 结论

三个缺陷全部修复并自证：**E1-001**（当前版本回滚 404 → no-op 200）、**E4-002**（同名双链歧义可观测 + 反链覆盖全部同名笔记）、**E3-003**（8 条 COUNT 合并为 1 条聚合，字段逐项一致）。E3-003 的「1 万篇 P95 ≤50ms」在**我名下无法单独达成**：剩余 ~100ms 全在"回表取 created_at"，实测补一条覆盖索引后 **P95 34.5ms 达标**，但建索引属 `db/**`（流 A），已作为跨流建议提出（第 3 节有实测数据与因果验证）。

## 1 DEF-E1-001 对当前版本回滚返回 404

**根因**：`NoteService.restore` 只在 `note_versions` 里找目标版本；而"当前版本"的正文只存在 `notes` 表（历史表只保存被替换掉的旧内容）。读接口 `VersionService.get` 有 `findCurrent` 兜底，写接口没有 → GET 200 / POST 404 不自洽。原代码里 `if (target.version() == current.version())` 那个 no-op 分支是**不可达**的（历史版本号恒小于当前）。

**改法**（3 个文件）：
- `history/VersionRepository.java` 新增 `resolve(spaceId, noteId, version)`：先 `findInHistory`，再回落 `findCurrent` 且版本号相等才算命中。
- `history/VersionService.java` 的 `get` 改用 `resolve`（行为不变，只是与写路径共用同一套解析）。
- `note/NoteService.java` 的 `restore` 改用 `resolve`；命中当前版本时**直接返回详情**：不写 `note_versions`、不改正文、不记 edit 日志（契约 §4.4 的 no-op）。

**语义选择**：对当前版本回滚 = **完全不写库的 no-op 200**（不产生新版本、不改 updated_at、不记行为日志）。理由：契约明写 no-op；若"回滚当前版本"还留快照，会使"快照数 = version−1"的不变量被无意义地打破。

**修前/修后**（`evidence/c/verify-before.log`、`verify-after.log`）：

| | 修前 | 修后 |
|---|---|---|
| GET /versions/2（当前版本） | 200，content=BBB | 200，content=BBB |
| POST /versions/2/restore | **404** `{"code":"NOT_FOUND","message":"版本不存在"}` | **200**，version 2→2、content 仍 BBB、historyCount 1→1 |
| 历史版本 /versions/1/restore | 200，content=AAA，version=3，history=2 | 同左（未回归） |

## 2 DEF-E4-002 同名笔记导致双链歧义

**选定方案**（两条都做了）：
1. **解析规则确定化 + 响应可观测**：同一标题多篇时仍解析到 **id 最小的存活笔记**（原有 `resolveTitle` 的顺序规则，已写进 Javadoc 固化）；`resolved[]` 元素新增 `candidates`（该标题当前有几篇存活笔记）与 `ambiguous`（candidates>1）；`LinkView` 顶层新增 `ambiguousTitles`（本次出链里所有歧义标题，去重）。
2. **反链给到所有同名笔记**：`LinkRepository.backlinks` 的匹配条件从"`target_note_id = 本篇`"扩成"`target_note_id = 本篇` **或** `target_title 与本篇标题同名（COLLATE NOCASE）`"。

**为什么选"给到所有同名笔记"**：双链语义是"按标题引用"；三篇同名时链接只会挂到第一篇，另两篇若反链永远为空、界面上又没有任何解释，用户会认为"我明明被引用了却看不到"。给全同名笔记最符合直觉，且不改变"实际跳转到哪一篇"的确定性（仍是 id 最小），歧义由 `ambiguous` / `ambiguousTitles` 显式暴露给前端。

**顺带修正口径**：`countBacklinks` 改为 `COUNT(DISTINCT source_note_id)`，与反链列表（按来源笔记去重）长度一致——此前两处口径不同，会出现"详情说 2 条、列表只有 1 条"。

**修前/修后**（`verify-before.log` / `verify-after.log` / `edge.log`）：

| 场景 | 修前 | 修后 |
|---|---|---|
| 3 篇同名 + `[[同名]]` | resolved 无歧义信息；3 篇反链 1/0/0 | resolved 带 `candidates=3, ambiguous=true`；`ambiguousTitles=["..."]`；3 篇反链 **1/1/1** |
| 唯一标题 | resolved 正常 | `candidates=1, ambiguous=false`，ambiguousTitles 为空，反链 1 |
| 软删目标 | 退化为 dangling | 仍退化为 dangling（未回归） |
| 反链计数一致性 | 可能 ≠ items 长度 | 三篇均 `items == detail.backlinkCount` |

## 3 DEF-E3-003 统计接口随数据量线性劣化

**改法**：`activity/ActivityRepository` 原有 8 条独立 `COUNT(*)`（notes 存活 / folders / tags / attachments / 附件字节 / 回收站 / 今日更新 / 14 天分组）合并成 **1 条 UNION ALL 聚合** `spaceStats(spaceId, today, from)` → `StatsAggregate`；notes 表一次扫描用 `SUM(CASE ...)` 同时算出存活数、回收站数、今日更新数，daily 分组挂在同一语句里。`activity/ActivityService.stats` 直接消费聚合结果（原 8 个计数方法随之移除）。
daily 分支用 `created_at >= :from` 而非 `substr(created_at,1,10) >= :from`（对 ISO-8601 文本等价，但范围谓词才能吃覆盖索引）。

**字段一致性**：`evidence/c/c-field-diff.mjs` 用**旧实现的 SQL 口径**直查同一份 DB，与 `GET /api/stats` 逐字段比对：

```
字段一致性: PASS（8 字段 + 14 天序列逐项一致）
```

**性能（1 万篇，同一份库、同一台机器）**：

| 版本 | p50 | p90 | p95 | max |
|---|---|---|---|---|
| 修前（8 条 COUNT） | 138.7ms | — | 145.5ms | 146.8ms |
| 修后（1 条聚合，无专项索引） | **114.6ms** | 122.4ms | 123.2ms | 123.4ms |
| 修后 + 覆盖索引（见下） | **30.9ms** | 34.5ms | **34.5ms** | 35.2ms |

**目标 ≤50ms 未达成的根因（已量化）**：`EXPLAIN QUERY PLAN` 显示 daily 分支走 `SEARCH notes USING INDEX idx_notes_space (space_id, deleted_at)` 之后**逐行回表**取 created_at —— created_at 在行内排在 content / search_blob 之后，等于为 1 万篇各读一次大字段。该分支单独就 105~113ms（`evidence/c/sql-probe.log`、`index-bench.log`）。

**跨流建议（点名流 A，db/**）**：在 SchemaMigrator 增加

```sql
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(space_id, deleted_at, created_at);
```

实测效果（`evidence/c/index-bench.log`）：daily 查询 **113.55ms → 6.54ms**（plan 变为 COVERING INDEX，不再回表）；建索引一次性 88ms（1 万篇）。
端到端实测（`evidence/c/index-e2e.log`，在 d-c 临时建索引 → 测 → 立即 DROP 复原）：`/api/stats` p50 **114.6 → 30.9ms**、p95 **123.2 → 34.5ms**；DROP 后回到 121.5ms —— 因果闭环。

## 4 验证矩阵

| 缺陷 | 原缺陷不可复现 | 正路径未坏 | 证据 |
|---|---|---|---|
| E1-001 | POST 当前版本 = 200 no-op（version/content/history 全不变） | 历史版本回滚仍 200 且产生新版本、不丢当前内容；快照数 = version−1 保持 | verify-after.log、edge.log |
| E4-002 | 3 篇同名全部有反链；resolved 带 candidates/ambiguous；ambiguousTitles 有值 | 唯一标题 candidates=1/ambiguous=false；软删目标仍退化为 dangling；backlinkCount 与列表一致 | edge.log |
| E3-003 | 8 字段 + 14 天序列与旧口径逐项一致 | 统计接口 200；其它接口无改动 | field-diff.log、field-diff-after.log |

编译：`kb-build.ps1` 多次 exit=0（build-before.log / build-after.log / build-after2.log）。

## 5 环境坑（给别人省时间）

1. **target/classes 会被并发构建短暂写坏**：第一次启动直接 `NoClassDefFoundError: com/kb/folder/FolderNode`（编译产物正被别人写）。重跑 `kb-build.ps1` 再启动即可，不需要 clean。
2. **不要在前台跑 `kb-run.ps1`**：run_code 有 120s 上限，超时会杀掉整棵进程树（连 java 一起），表现为「pid=... ready=True 但端口立刻消失」。用 `Start-Process powershell -File kb-run.ps1 ...` 分离启动，再自己轮询 `/api/health`。
3. **PowerShell `$pid` 是只读自动变量**，采样脚本里必须换名（`$javaPid`），否则赋值失败且不中断脚本。
4. 数据目录 `F:\work\test\kb\d-c` 保留（1 万篇 + 目录/标签/附件/回收站数据），便于复跑证据脚本；实例已 Stop。

## 6 未做 / 需配合

- **E3-003 的 ≤50ms 目标**：依赖流 A 在 `db/SchemaMigrator` 加 `idx_notes_created`（数据见第 3 节）。加完后 `/api/stats` 预计 30~35ms，我这边**无需再改代码**（查询形状已按覆盖索引对齐）。
- `ResolvedLink` / `LinkView` 是**新增字段**，既有字段类型未变（`noteId:long / title:String / folderId:Long / resolved / dangling` 原样）。前端若要提示歧义，读 `ambiguousTitles`（属流 F）。
## 7 既有 Java 测试回归（流 C 相关 3 个测试类）

命令（与 kb-build 相同的文件锁串行化，避免抢 target/）：
```
mvn -o test -Dtest=NoteApiIntegrationTest,LinkApiIntegrationTest,ActivityStatsApiTest -DfailIfNoTests=false
```
日志：`evidence/c/mvn-test-c.log`

| 测试类 | 结果 | 说明 |
|---|---|---|
| com.kb.activity.ActivityStatsApiTest | **4/4 通过** | 含"各计数与查库行数一致 + dailyCreated 恰 14 天"——直接验证了统计聚合改造的字段一致性 |
| com.kb.link.LinkApiIntegrationTest | **8/8 通过** | 含 resolved/dangling、软删退化为 dangling、反链上下文、跨空间 404 |
| com.kb.note.NoteApiIntegrationTest | **13/14 通过** | 唯一失败项与流 C 无关，见下 |
| 合计 | **25/26** | |

**唯一失败项归因（不是流 C 引起）**：`NoteApiIntegrationTest#inlineHtmlIsStrippedFromSearchIndex` → `GET /api/search` 返回 400（期望 200）。
- 该用例只走"建笔记 → 详情 → search → /api/notes?q="，不触碰 note/history/link/activity 里我改过的方法；
- **隔离验证**：把 `search/SearchHighlighter.java、SearchRepository.java、SearchService.java` 三个文件换回 20261028-181736 快照版本（其余全部保持当前，含我的改动），同一条用例 **PASS**（`F:\work\test\_c_iso\iso-test.log`，BUILD SUCCESS）。
- 结论：400 由 `com.kb.search` 包的当前改动（流 A 名下，正在修 E3-001/E3-002/E4-003）引入，应转交流 A；我未改 search 包任何文件。

## 8 收尾

- 实例已 Stop（`kb-run.ps1 -Stop -Port 8533`），`Get-NetTCPConnection -LocalPort 8533` 无 LISTEN。
- 数据目录 `F:\work\test\kb\d-c` 保留（1 万篇 + 目录/标签/附件/回收站），便于复跑 `evidence/c/*.mjs`。
- 未改：真实库 `data/kb.db`、8080 实例、pom.xml、他人包、docs/test-20261027；未删任何文件；mvn 全程 `-o`。

# 流 E 修复进展（w6-req-analysis）

日期：2026-10-28　端口：8535　数据目录：F:\work\test\kb\d-e（已清理）

## 1. DEF-E5-009（S3/P1）简报/周报 run 端点不受开关约束

### 根因
`enabled` 只在 `runIfDue()`（定时任务/启动补抓）里判断，手动 `POST /run` 走的是 `run()`，**完全没检查开关**。

- BriefingService.java:105-109（`runIfDue` 有判断）vs :91 `run(...)` 无判断；
- WeeklyService.java:102-106（`runIfDue` 有判断）vs :90 `run(...)` 无判断。

### 改法（2 个文件，各 3 行）

| 文件 | 位置 | 改动 |
|---|---|---|
| backend/src/main/java/com/kb/briefing/BriefingService.java | `run(long,long,String)` 方法首行 | 进入并发锁与任何抓取**之前**：`if (!properties.isEnabled()) throw ApiException.forbidden("简报功能已关闭（kb.briefing.enabled=false），已拒绝执行，未发起任何外网请求")` |
| backend/src/main/java/com/kb/weekly/WeeklyService.java | `run(long,long)` 方法首行 | 同上，文案为「周报功能已关闭（kb.weekly.enabled=false），已拒绝执行，未发起任何外网请求」 |

`BriefingService.run(long,long)`（2 参重载）委托给 3 参版本，因此两条入口都受约束；`GlobalExceptionHandler` 把 `ApiException` 映射为 `{error:{code,message}}` + HTTP 403。

### 修前 / 修后

**修前**（2026-10-27 E5 实测，`evidence/e5/probe.json` V13）：
```
POST /api/briefing/run   (kb.briefing.enabled=false)
-> HTTP 200  status=partial  totalItems=31  newItems=31
   并且真实完成了 31 条外部抓取（耗时 15s 级）
```

**修后**（本轮，`evidence/e/probe-disabled.json`）：
```
POST /api/briefing/run -> 403  ms=36  {"error":{"code":"FORBIDDEN","message":"简报功能已关闭（kb.briefing.enabled=false），已拒绝执行，未发起任何外网请求"}}
POST /api/weekly/run   -> 403  ms=17  同上文案（weekly）
```
36ms / 17ms 是「没有发起任何 HTTP 请求」的代理证据（正常一次抓取是 10–20 秒量级）。

### 正路径未坏（`evidence/e/probe-enabled.json`）

用 `-Dkb.briefing.enabled=true` 且把 10 个源全部列入 `skip-sources` 起实例（这样即使放行也不会外连）：
```
POST /api/briefing/run -> 200 ms=258 status=success totalItems=0 newItems=0
   sourceReport 10 条全部 skipped=true（已知不可达，本次已跳过）
GET  /api/briefing/sources -> 200 items=10 skipped=10
```
258ms 且 10 源全 skipped → 闸门放行、未误拦、**也没有外连**。

### 只读端点不受影响
```
GET /api/briefing/sources -> 200 items=10   （关闭态）
GET /api/briefing/runs    -> 200 items=0
GET /api/weekly/runs      -> 200 items=0
GET /api/archive/runs     -> 200 items=1
```

## 2. 另外三个 run 端点的核查结论（不在我的包，转达）

| 端点 | 开关关闭时的实际行为 | 是否外连 | 结论 |
|---|---|---|---|
| POST /api/archive/run | 200 + `status:"disabled"`（ArchiveService.java:61-64 已判断） | 否（纯本地搬目录） | **安全**。但与 briefing/weekly 的 403 口径不一致，建议归档负责人统一为 403 |
| POST /api/autotag/run | 200 + `{scanned:0,tagged:0,tags:[]}`（AutoTagService.java:36-39 已判断） | 否（本地规则） | **安全**。`kb.autotag.enabled` 默认 false，本来就关着 |
| POST /api/weekly/run | 403（本轮改后） | 否 | 已修 |

## 3. 文档修复（8 条）

逐条「文档行 ↔ 代码位置」对照见 `evidence/e/doc-map.md`，摘要：

| 缺陷 | 文件 | 要点 |
|---|---|---|
| E5-002 | docs/API.md | **复核后修正**：8 个 URI 中 7 个已由 §12.2~§12.5、§12.7 登记（并发新增，我 E5 报告时尚未出现）；仍缺的 `GET /api/export/notes/{id}` 已补进 **§12.8**。我先写的 §13 与 §12 重复，已撤销 |
| E5-003 | docs/SCHEMA.md | §5 开头注明实为 6 张表；新增 §5.4.1~5.4.4 补登 archive_runs / repo_star_snapshots / weekly_runs / briefing_cache 的完整 DDL；§5.5 表清单（26 + 6 = 32 条 DDL） |
| E5-004 | docs/API.md | §11.4 参数表由 7 键重写为 **28 键**四组；`kb.briefing.folder` 实际值改为 `AI时代笔记` |
| E5-005 | docs/README.md | 「185 个测试」→「54 个测试类 / 331 个 @Test」，并注明 159/185/233/242 作废 |
| E5-006 | docs/使用手册.md | 入口清单 10 项 → 13 项；新增「AI 简报」小节（此前正文零记载） |
| E5-007 | docs/使用手册.md | 图注「启动」→「登录页」并加一句说明 |
| E5-008 | docs/VERIFY.md + docs/README.md | VERIFY 仅在文首加声明（列出三类已知过时项）；README 同步标注 |
| E5-010 | docs/README.md | 删除「首次自动下载 Maven」，改为缓存路径 + `mvn -o` 离线构建 |

## 4. 编译
```
powershell -File F:\work\test\kb\kb-build.ps1   ->   mvn exit=0   （evidence/e/build.log）
```

## 5. 未修 / 降级

1. **DEF-E5-007 的图片本身**：`images/02-登录页.png` 确实是登录页（不是启动截图），我只改了图注，没有重拍截图（截图不在我的所有权内，且重拍需要真浏览器）。
2. **DEF-E5-008 的正文过时数字**：按你的指示 VERIFY.md 只加文首声明，正文数字一律不动。
3. **Java 单测未跑**：`mvn -o test` 会与其它流的构建抢 target/，且耗时长；已改代码只涉及 2 个 service 方法首行，测试里对 `briefingService.run(...)` 的调用均在默认 `enabled=true` 下进行，不受影响。建议在最终打包时由你统一跑 331 项。

## 6. 需要别人配合

1. **归档负责人（含 archive 包的流）**：`POST /api/archive/run` 在开关关闭时返回 `200 + status=disabled`，与 briefing/weekly 的 403 口径不一致，建议统一（不影响安全，因为归档不联网）。
2. **自动标签负责人（autotag 包）**：同上，返回 200 空统计；若要统一可改为 403。
3. **API.md 也存在并发改动**：§12.1~§12.7（搜索增强 / 附件体检 / 归档 / 自动标签 / 周报 / 长文速览 / manifest MIME，标注 2026-10-27）在我 E5 分析之后被其他流写入。我据最新内容撤销了重复的 §13，只保留 §12.8 这一条真正缺失的。
4. **文档所有权冲突**：`docs/使用手册.md` 在我作业期间被其他流改过（新增了「关系图」专节与「断网了也能打开外壳」小节、`03-主界面-标注.png` 由 .jpg 换成 .png）。我按最新内容合并，未回退他人改动；但我原报告里「手册 0 处提及关系图」是**我的检索失误**，实际手册早有专节 —— 已在 doc-map.md 里更正。

## 7. 红线

- 未碰 data\kb.db、未碰 8080；
- 只改了自己名下的包（briefing/、weekly/）与 5 份文档（API.md、SCHEMA.md、README.md、使用手册.md、VERIFY.md 仅文首）；
- 未改 pom.xml、未装依赖、未联网（全程 mvn -o）；
- 8535 已 stop 并确认端口释放；临时数据目录 F:\work\test\kb\d-e 已删除。
## 8. 追加任务（2026-10-28 晚）：导入上限语义 + 导出/导入不对称

B 流实现后，API.md §10 需同步。已核对代码再写，避免契约与实现不符：

| 改法 | 位置 | 代码依据（逐字核对） |
|---|---|---|
| 新增 §10.3.1 超量 ZIP 的拒绝语义（4 种触发条件 × 413 × 原话 message；校验在写入前、库内 0 新增；preview 同样 413） | docs/API.md | ImportService.java:61-62 MAX_ZIP_ENTRIES=2000；:320-323 条目超限文案；:336-338 解压超限文案；:269-273 多选/文件夹文案；:304-305 硬校验整批拒绝 |
| 新增 §10.3.2 空文件计 skipped、不落库 | docs/API.md | ImportService.java:468-471 |
| 新增 §10.4 导出/导入上限不对称（已知限制、不放宽、两条替代路径） | docs/API.md | API.md:320 整库导出为每篇一个条目；ExportController 单篇 .zip/.md；前端 views/io/index.tsx 只有「导出全部」与「单篇导出」两种（无按目录导出） |
| §10.3 原「ZIP 条目数上限 2000」条目加指路 | docs/API.md:428 | — |

未改代码；`data\kb.db`、8080 仍未触碰；本轮未再起实例（纯文档）。

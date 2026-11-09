# 流 B 进展

（追加式记录：改了什么、怎么验的）

## 2026-10-28 第一轮（导入导出三缺陷）

**改的文件（都在我的独占范围内）**
- `backend/src/main/java/com/kb/ioport/ImportService.java`
- `backend/src/main/java/com/kb/ioport/AssetIndex.java`

**改了什么**
1. DEF-E2-001 ①：`addMarkdown()` 解码后判 `text.isBlank()` → `batch.skipped++` 并返回，空内容永不落库。
2. DEF-E2-001 ②④：`readZip()` 的「超条目数 / 超解压总大小」从 `errors.add + return` 改为 `throw ApiException(PAYLOAD_TOO_LARGE, …)`；`parse()` 增加 `catch (ApiException e) { throw e; }` 前置分支，保证硬校验在**写库之前**整批拒绝（preview 与 import 行为一致）。
3. DEF-E2-001 ③ + DEF-E3-004：`importMarkdown()` 逐篇事务 → 每 `IMPORT_BATCH_SIZE=200` 篇一个事务，批内失败整批回滚且只把该批文件写进 errors，其余批继续。
4. DEF-E1-003：`AssetIndex` 增加图片标记与 `unreferencedNonImageCount()`；`Batch.skippedTotal()` 改用它（图片类条目不再计入 skipped；旧 `unreferencedCount()` 保留语义，`ImageRefsTest` 不受影响）。

**怎么验的（两轮，各自全新数据目录）**
- 编译：`kb-build.ps1` → mvn exit=0。
- 小库模式（`KB_SKIP_HEAVY=1`）：14/14 通过 —— 含空文件、3 篇批量、图片重写、preview、Zip Slip、非 UTF-8、不支持的扩展名、整库往返（导出 7 篇 + 2 附件 → 新空间导入 imported=7/imagesImported=2/skipped=1，字节一致）。
- 重库模式（`KB_SKIP_ROUNDTRIP=1`）：16/16 通过 —— 2001 条目 → **413 且库内 0 新增**；1999 → imported=1999；2000 → imported=2000；1000 篇 **3202ms**（改前 14930ms）。
- 脚本与原始输出：`docs/test-20261028/evidence/b/`（`verify-import.mjs` + `verify-*.json` + `summary-b.md`）。

**取舍与待定（已写进 summary-b.md §5/§6）**
1. 超量 ZIP 响应码由 200 改为 **413**（契约未规定码，选与"文件数/大小超限"一致的码）。这会与 E2 的 TC-IMPEXP-201 断言冲突，需同步；若要求保持 200，只需改成返回 200 + imported=0 + errors=[原因]。
2. 发现既有冲突：`/api/export/all` 每篇笔记一个 ZIP 条目，笔记数 > 2000 时该导出包无法再导入（现在表现为明确的 413，修复前是"写 2000 条 + 报错"的静默损坏）。**未擅自放宽上限**（那是 DoS 防线），建议调度者决策：对自家导出格式放宽 / 分片导出 / 文档写明边界。
3. 批量事务的"单批失败整批回滚"未做故障注入验证，只验证了正常批量提交与校验失败零写入。

## 2026-10-28 裁决记录（Lead 确认，待命）

1. **超量 ZIP 返回 413**：Lead 批准。理由与我的实现一致（契约只要求"整包拒绝、零写入"，413 与"文件数/总大小超限"两处既有实现同构）。TC-IMPEXP-201 的旧断言（200 + imported=2000）按"固化旧 bug"处理，由 Lead 在回归时按新行为判定，**我不改测试脚本**。
2. **整库导出 >2000 篇无法导回**：**不放宽上限**（保持 DoS 防线），按"文档化边界"处理，已由 E 流在 API.md 写死该边界并给分片导出建议，**我不动代码**。
3. 临时数据目录 `F:\work\test\kb\d-b` 由 Lead 在最终清理时统一处理，我不删。

**状态：进入待命，不再改代码。** 当前交付状态（可随时复核）：
- 代码：`com/kb/ioport/ImportService.java`、`com/kb/ioport/AssetIndex.java`（仅这两个文件）
- 编译：`kb-build.ps1` = mvn exit=0（最终状态已复跑）
- 自测：小库 14/14、重库 16/16 全通过；证据 `docs/test-20261028/evidence/b/`（`summary-b.md` + `verify-*.json` + `verify-*.log`）
- 端口 8532 已 Stop（监听 0、无残留 java）；`data\kb.db` 未触碰（mtime 仍为 04:15）

# 知识库项目 · 全面测试协作契约（调度者维护）

生成：2026-10-27 | 本目录：D:\work\知识库\docs\test-20261027

## 1. 被测系统事实（已核实，不要再猜）

| 项 | 事实 |
|---|---|
| 路径 | D:\work\知识库（**不是 git 仓库**，改动不可回滚） |
| 后端 | Java 21 + Spring Boot 4.1.1（Maven 工程，pom.xml 为**重建版**，标注 RECONSTRUCTED-POM） |
| 前端 | React 19 + TypeScript + Vite 8 + CodeMirror 6；**已预构建**为静态资源放在 backend/src/main/resources/static |
| 存储 | SQLite + FTS5（中文全文检索），数据目录默认仓库 data/，可用 --kb.data-dir 覆盖 |
| 鉴权 | 服务端 Session，Cookie 名 KB_SESSION（http-only、same-site=lax） |
| 规模 | 4232 文件；252 个 .java；已有 Java 测试 71 个测试类 |
| 文档 | docs/API.md（28KB，接口契约，含 v1 修订注记）、SCHEMA.md、README.md、使用手册.md、VERIFY.md(80KB)、BRIEFING.md、EDITOR-FORMAT.md、IMPORT-IMAGES.md |
| 构建 | **无 Maven**（mvn 未安装，mvnw 缺 wrapper jar 且分发包 404）→ 既有 Java 测试本轮无法直接执行，已列为限制 |
| 运行 | 自带 jar：backend/target/knowledge-base-0.0.1-SNAPSHOT.jar |

## 2. 启停隔离实例（统一用这个脚本，别自己拼命令）

脚本：`D:\work\知识库\docs\test-20261027\suites\kb-harness.ps1`（注意：该文件必须是 **UTF-8 带 BOM**，否则 PowerShell 5.1 会把中文路径读坏）

```powershell
cd 'D:\work\知识库\docs\test-20261027\suites'
.\kb-harness.ps1 -Action start -Port 8502 -DataDir 'F:\work\test\kb\d-e1'
.\kb-harness.ps1 -Action health -Port 8502
.\kb-harness.ps1 -Action stop  -Port 8502
```

端口分配（**严禁串用**）：E1=8502　E2=8503　E3=8504　E4=8505　E5=8506（只读文档，可不占端口）。基线 8501 由调度者占用。
数据目录：F:\work\test\kb\d-<流>（脚本会自动建）

> 实例已默认关闭每日 AI 简报与开源周报（--kb.briefing.enabled=false --kb.weekly.enabled=false），避免外网请求。

## 3. 红线（违反即任务失败）

1. **禁止修改 D:\work\知识库 下任何源码/配置/文档**（server、frontend、backend/src、docs 既有文件、pom.xml 全只读）。你的产出只写 `docs/test-20261027/` 下。
2. **禁止触碰 data\kb.db**（用户的真实知识库数据，507KB）与 data\uploads；一律用自己 --kb.data-dir 指向的临时目录。
3. **禁止 kill 8080 上的服务**（PID 7592，来自另一个目录副本），也不要向 8080 写任何东西。
4. 禁止跑 `mvn`/`mvnw`（不可用）；禁止安装依赖；禁止联网抓取外部数据（简报/周报功能已关）。
5. 每个流只用自己的端口与数据目录；结束前必须 stop 并确认端口释放。
6. 上传/导入类用例只造小文件；清理自己产生的临时文件。

## 4. 产物目录

```
docs\test-20261027\
  suites\    你的测试脚本（前缀 <流>-，如 e1-notes.mjs）
  evidence\<流>\  原始证据（响应、日志、截图、DB 查询结果）
  logs\      实例日志（脚本自动写 kb-<port>.out/err.log）
```

## 5. 编号与回报

- 用例：`TC-<模块>-<3位>`，模块代码：AUTH 认证 / FOLDER 目录 / NOTE 笔记 / SEARCH 搜索 / TAG 标签 / FILE 附件 / TRASH 回收站 / IMPEXP 导入导出 / STAT 统计与动态 / ADMIN 管理 / UI 界面 / NF 非功能 / BRIEF 简报
- 缺陷：`DEF-<流>-<3位>`（E1..E5 各用自己前缀）
- 严重等级：S1 致命（数据损坏/越权读他人数据/系统不可用）| S2 严重（核心功能错或数据错误）| S3 一般 | S4 轻微
- 优先级：P0 立即 | P1 本迭代 | P2 排期 | P3 可延后

缺陷必填字段：编号 / 标题 / 模块 / 关联用例 / 严重+优先级 / 前置 / 复现步骤 / 期望 vs 实际 / 证据路径 / 复现率。

## 6. 回报格式（send_message 给 lead）

1. 一句话结论
2. 执行统计（用例数/执行/通过/失败/阻塞）
3. 缺陷清单（S1→S4，字段齐全；同根因合并并注明影响面）
4. **通过的关键用例也要列**（编号+一句话）
5. 证据路径
6. 环境坑 / 阻塞
7. 声明：是否碰过 data\kb.db、8080、项目源码（应为否）

## 7. 本轮范围边界（明确不测）

1. 真实外网抓取（每日 AI 简报的 HackerNews/DeepL、开源周报 GitHub/Gitee）——已关闭，仅测「关闭时是否安全降级」。
2. Cloudflare 隧道公网访问。
3. 既有 Java 单元/集成测试的执行（无 Maven，已列限制；调度者会单独尝试一次离线方案）。
4. 缺陷修复（用户未确认，本轮只报告）。
5. 前端源码构建（dist 已预构建；不跑 npm build）。
## 8. 运行中发现并固化的口径（2026-10-27 追加）

1. **禁止** `POST /api/briefing/run`、`/api/weekly/run`、`/api/archive/run`、`/api/autotag/run`：它们不受 enabled 开关约束，会真实外连。只读的 status/sources 可测。
2. multipart 上传字段名是 **file**（不是 files）。
3. 每轮用例要用**全新数据目录**：空库时首个注册用户自动成为 admin。
4. 后端规模以实测为准：main 197 个 .java；test 54 个测试类 / 331 个 @Test（既有 Java 测试已由 Lead 离线执行，结果见 05-执行记录）。
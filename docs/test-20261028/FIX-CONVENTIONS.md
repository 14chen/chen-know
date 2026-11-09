# 知识库缺陷修复 · 协作契约（调度者维护）

输入：docs/test-20261027/06-缺陷报告.md（26 条）、07-度量、08-总结。
回滚点：F:\work\test\snapshots\kb-20261028-181736.zip（改动前全量，248.7MB）。

## 1. 关键环境事实（已由我验证，别再自己摸索）

| 项 | 事实 |
|---|---|
| 构建 | **Maven 3.10.0 已存在于** C:\Users\HP\.m2\wrapper\dists\apache-maven-3.10.0\...\bin\mvn.cmd，可**离线**编译（mvn -o）。已实测 `mvn -o -q -DskipTests compile` exit=0 |
| 前端构建 | frontend/node_modules 已存在（含 vite + tsc），可离线 `npm run build` |
| 运行方式（推荐） | **不必打 jar**：用 F:\work\test\kb\kb-run.ps1 从 target/classes 直接启动，改完编译即可验证 |
| 编译（并发安全） | 用 F:\work\test\kb\kb-build.ps1（内置文件锁，多流并发时排队，别直接调 mvn 以免抢 target/） |
| 依赖 classpath | F:\work\test\kb\cp-runtime.txt 已生成（9961 字符），由 kb-run.ps1 自动使用 |
| 真实库 | data\kb.db **只读红线**；所有实例必须 -Dkb.data-dir 指向 F:\work\test\kb\d-<流> |
| 8080 | 用户自己的实例（PID 7592，来自另一目录副本），**禁止触碰** |

常用命令：
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File F:\work\test\kb\kb-build.ps1        # 编译（自动排队）
powershell -NoProfile -ExecutionPolicy Bypass -File F:\work\test\kb\kb-run.ps1 -Port 8531 -DataDir F:\work\test\kb\d-a
powershell -NoProfile -ExecutionPolicy Bypass -File F:\work\test\kb\kb-run.ps1 -Port 8531 -Stop
```

## 2. 文件所有权（**硬边界**，按 Java 包 / 前端目录切分，零重叠）

| 流 | 独占范围 | 端口 | 缺陷 |
|---|---|---|---|
| **A**（fix-a1） | backend/src/main/java/com/kb/**search/**, **db/** | 8531 | E3-001 大正文拖慢搜索、E3-002 并发搜索塌陷、E4-003 三字无高亮（先查是否在后端高亮器）、E3-005 DB 不回收、E3-006 无连接池 |
| **B**（w1-functional） | backend/src/main/java/com/kb/**ioport/** | 8532 | E2-001 导入非原子+超量、E1-002（并入 E2-001）、E3-004 导入逐篇事务、E1-003 skipped 计数 |
| **C**（w3-performance） | backend/src/main/java/com/kb/**note/**, **history/**, **link/**, **activity/** | 8533 | E1-001 当前版本回滚 404、E4-002 同名双链歧义、E3-003 统计线性劣化 |
| **D**（w2-security） | backend/src/main/java/com/kb/**config/**, **common/** | 8534 | E2-002 缺 CSP/Referrer-Policy、E2-003 Cookie 无 Secure、E2-004 跨源写无 Origin 校验 |
| **E**（w6-req-analysis） | backend/src/main/java/com/kb/**briefing/**, **weekly/** + **docs/*.md**（API.md、SCHEMA.md、README.md、使用手册.md） | 8535 | E5-009 enabled=false 拦不住手动 run、E5-002 8 个 URI 未登记、E5-003 SCHEMA 漏表、E5-004 参数表、E5-005 测试数口径、E5-006 手册缺入口、E5-007 图注、E5-008 VERIFY 过时、E5-010 README 自动下载 Maven 不实 |
| **F**（w4-ui-e2e） | **frontend/**（含 src 与构建配置）+ 构建产物复制到 backend/src/main/resources/static | 8536 | E4-001 界面无法改标题、E4-004 删笔记后残留请求、E4-005 搜索页 405 端点、响应式多端体验优化 |

**谁都不能改**：其他流的包、`application.properties`（属 D）、`pom.xml`、`node_modules`、`data/**`、`docs/test-20261027/**`（测试报告只读）。
需要别人改的，写进自己的 notes 并在回报里点名，由我转达。

## 3. 红线

1. 不改真实数据 data\kb.db、不碰 8080。
2. 不删文件、不改 pom.xml、不装依赖、不联网（Maven 必须加 -o）。
3. 每个实例用自己的端口与数据目录；收尾必须 Stop 并确认端口释放（Get-NetTCPConnection）。
4. **不许为了让测试通过而放宽安全边界或删断言**；测试脚本在 docs/test-20261027/suites/ 只读，可**复制**到自己 evidence 目录再改。
5. 改完必须自证：**原缺陷不可复现 + 正路径未坏**，两条都要有命令与输出。

## 4. 验证要求（修完的定义）

1. **复现原文**：按 06 报告里的复现步骤跑一遍，确认失败 → 修复后确认通过。
2. **不回归**：跑相关接口的正常路径（如改搜索要验证 1/2/3 字都能搜到且高亮正常）。
3. **编译过**：kb-build.ps1 必须 exit=0。
4. 证据落 `docs/test-20261028/evidence/<流>/`；进展写 `docs/test-20261028/notes-<流>.md`（追加式）。

## 5. 回报格式（send_message 给 lead）

1. 一句话结论
2. 逐条缺陷：编号 → 改法（哪个文件哪个方法）→ 修前/修后证据（命令 + 关键输出）
3. 改了哪些文件（完整清单）
4. 编译结果（kb-build.ps1 exit=?）与自测结论
5. 未修/降级的项及原因
6. 需要别人配合的事项（点名 A~F）
7. 红线声明：是否碰过 data\kb.db / 8080 / 他人文件（应为否）

## 6. 交付打包（只由我做）

最终由我执行：前端 `npm run build` → 复制到 backend/src/main/resources/static → `mvn -o -DskipTests package` 重新产出 jar → 跑全量回归（含既有 Java 测试 328 项、e1~e4 测试脚本、响应式与多端检查）。你们不要动 jar。
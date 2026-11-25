# P1 任务清单

## quality-gate（进行中）

- [x] 能力地图 + 模块规格确认（阈值 70 / 模板句可配 / 降级保留 / 历史只读）
- [x] 切片1：QualityInput、QualityRule 与五条规则 + 单元测试（6/6 通过）
  - Acceptance: null/套话/截断/LaTeX 各命中；近似重复降级；纯函数无副作用
  - Verify: `.\mvnw.cmd -B -Dtest=QualityRuleTest test`
  - Files: `backend/src/main/java/com/kb/quality/**`, `backend/src/test/java/com/kb/quality/QualityRuleTest.java`
- [x] 切片2：QualityGate 编排 + QualityProperties（12/12 通过）
  - Acceptance: 多规则扣分叠加、分数下限 0、≥70 accepted、模板句可由配置追加
  - Verify: `.\mvnw.cmd -B -Dtest=QualityGateTest test`
  - Files: `QualityGate.java`, `QualityProperties.java`, `application.properties`
- [x] 切片3：content_quality 表 + Repository + 只读报告 API（15/15 通过）
  - Acceptance: 迁移幂等；报告扫描 briefing_cache 并按空间隔离；错误格式统一
  - Verify: `.\mvnw.cmd -B -Dtest=QualityReportApiTest test`
  - Files: `SchemaMigrator.java`, `QualityReportRepository.java`, `QualityController.java`, docs
- [x] 切片4：接入简报渲染前评分（低分降级保留，34/34 通过）
  - Acceptance: 旧流程不变；低分条目不进「今日必读」候选但仍在正文；评分落表
  - Verify: `.\mvnw.cmd -B -Dtest=BriefingApiTest,QualityGateTest test`
  - Files: `BriefingService.java`, `BriefingRenderer.java`
- [x] 切片5：文档 + 全量回归（401/401）+ 真实报告接口验收（5 扫 4 降级、错误码 400）
  - Acceptance: `docs/QUALITY.md` 与代码一致；全部测试与构建通过
  - Verify: `.\mvnw.cmd -B test`；`GET /api/quality/report?module=briefing`
  - Files: `docs/QUALITY.md`

## ai-analysis（进行中）

- [x] 规格确认（默认 none / 地址留空 / 上限 20 / 不改正文）
- [x] 切片1：AnalysisRequest/Result、AnalysisClient、Noop、属性绑定 + 单测（5/5）
- [x] 切片2：OpenAI-compatible 客户端（严格 JSON 校验、地址校验、key 仅环境变量、失败降级，9/9）
- [x] 切片3：ai_analysis 表 + 缓存(content_hash) + StructuredAnalysisService（预算上限、失败降级，14/14）
- [x] 切片4：全量回归（416/416）+ 文档 + 真实运行验收（provider=none 零外呼、表已建且 0 行）

## briefing-experience（已完成 2026-11-22）

- [x] 规格确认（note 不改版 / AI 标签优先 + 规则兜底 / 本地个性化默认开 / 反馈仅两个按钮）
- [x] 后端：briefing_items + briefing_feedback 表、主题分类、本地个性化、条目/反馈 API（417/417 全量通过）
- [x] 前端：今日必读 Top5 + 主题筛选 + 搜索分页 + 详情抽屉 + 反馈 + URL 状态（harness 45/45）
- [x] 文档 + 四断点截图 + 真实应用验收（12 张卡片、Top5 标题正确、零 console 错误）

## weekly-experience（已完成 2026-11-22）

- [x] 规格确认（note 不改 / AI 优先规则兜底 / 真实相邻快照 / 内联 SVG）
- [x] 后端：weekly_project_weeks + weekly_project_profiles 表、真实星增、项目档案、Top3 解读、查询 API（420/420）
- [x] 前端：周选择器 + sparkline + Top3 + 主题筛选 + 详情抽屉（tsc 0 错误）
- [x] 全量回归 + 真实应用验收（2 周可选、3 个 Top3、3 条 sparkline、零溢出、零 console 错误）

## P2 / run-lifecycle（已完成 2026-11-22）

- [x] 规格确认（异步可选 / 协作式取消 / 4 阶段 / DB 部分唯一索引）
- [x] 后端：run_progress 表、异步启动、分阶段进度、取消、DB 级并发锁（423/423）
- [x] 前端：简报/周报进度条 + 取消按钮；harness 45/45，tsc 0 错误
- [x] 真实应用验收：进度接口返回阶段文案、取消标记生效、409 并发保护

## P2 / observability（已完成 2026-11-22）

- [x] 规格确认（新表 / 单价可配默认 0 / 明细看自己空间+汇总管理员 / key=value 日志）
- [x] 后端：run_metrics 表、阶段耗时/条目数/AI token 落表、token 从 usage 解析、ops 端点（425/425）
- [x] 日志：简报/周报一行 INFO 追加 runId/module/items/aiCalls/tokens 字段
- [x] 真实应用验收：ops 明细返回真实指标；临时数据已清理

## P2 / source-health（已完成 2026-11-22）

- [x] 规格确认（5 次失败→30 分钟 / 冷却标注 / 新表 / HN 7 天）
- [x] 后端：source_health 表、抓取前判冷却、抓取后记录耗时、ops/sources 端点、HN numericFilters（427/427）
- [x] 前端：源状态表显示冷却/跳过原因；harness 45/45、tsc 0 错误
- [x] 文档：docs/SOURCE-HEALTH.md、docs/API.md 已同步

## P2 / retention-security（已完成 2026-11-22）

- [x] 规格确认（清理默认开 / 近重复直接丢弃 / DNS+跳转重校验 / localhost 单独白名单）
- [x] 后端：RetentionService+Scheduler、SemanticDeduper、URL 转义、SSRF 加固、MiniJson 深度+代理对（433/433）
- [x] 文档：docs/RETENTION-SECURITY.md、docs/API.md 已同步

## P2 全部完成

四个模块 run-lifecycle / observability / source-health / retention-security 均已交付并验证。

## 内容改良 / engagement（已完成 2026-11-23）

借鉴 last30days「真实互动量 + 跨源印证 + 社区原话」，纯 Java 增量，note 正文冻结。

- [x] 切片1：Engagement 热度算法 + HN `num_comments` 解析 + 高赞原话抓取（上限 3 条，失败静默）
- [x] 切片2：热度落 `briefing_items` 并经 API 暴露；「今日必读」Top5 改按热度排序 + 热度徽标
- [x] 切片3：近重复从「直接丢弃」改为「聚簇 + 印证数 + 来源链接」；详情抽屉展示多源印证
- [x] 切片4：GitHub `open_issues_count` / `forks_count` 搭车同一 API 响应，落 `weekly_project_weeks`，Top3 显示活跃度证据
- [x] 全量回归 443/443；前端 `tsc -b` 0 错误、mock A 92/92 + B 72/72
- [x] 真实应用验收（隔离数据目录）：简报热度/原话、周报 issue/fork 均落库；3 张截图已确认
- [x] 文档：`docs/CONTENT-ENGAGEMENT.md`、`docs/API.md` 已同步

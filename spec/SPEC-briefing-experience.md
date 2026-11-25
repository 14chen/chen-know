# Spec: 简报体验升级（briefing-experience）— V1

> 依赖：`spec/SPEC-quality-gate.md`（已实现）、`spec/SPEC-ai-analysis.md`（已实现，运行时可选）。
> 这是第一个改变简报 note 排版与网页视图的模块。

## Objective

把简报从「按源分组的链接列表」升级为「可决策的早报」：打开就知道**今天该读哪 5 条、为什么、和自己已有的知识有什么关系**，并能给出反馈让下次更准。

用户价值：
- 不再从头翻 36 条链接；Top5 直接给出质量分、关键点和理由。
- 低质量条目仍保留在附录，不丢信息。
- 反馈（有用/不感兴趣）回流到排序，越用越准。

## Tech Stack

- 后端：Java 21 + Spring Boot 4.1 + JdbcTemplate（沿用现有栈）
- 前端：React 19 + TypeScript + 现有 `components/` 与 `styles/views-admin.css` 命名空间 `vw-brief-`
- 无新增运行时依赖

## Commands

```
cd backend && .\mvnw.cmd -B -Dtest=BriefingItemsApiTest,BriefingFeedbackApiTest test
cd frontend && node node_modules\typescript\bin\tsc -b --pretty false
cd tools/verify/frontend-admin/briefing && node mock.mjs --port 8899   # 另开终端
  + node ../../../../frontend/node_modules/vite/bin/vite.js --config vite.config.mts
  + node verify.mjs
cd backend && .\mvnw.cmd -B test
```

## Project Structure

```
backend/src/main/java/com/kb/briefing/
    BriefingItem.java / BriefingItemRepository.java   # 条目明细（新表 briefing_items）
    BriefingFeedbackController.java                   # 反馈写入
    BriefingRunDetailController.java                  # GET /api/briefing/runs/{id}
    BriefingTheme.java                                # 规则主题分类（AI 标签优先）
    BriefingPersonalizer.java                         # 本地相关度（RelatedService），不外发
backend/src/main/java/com/kb/db/SchemaMigrator.java   # 追加 2 张表
frontend/src/views/briefing/index.tsx                 # Top5 + 主题速览 + 条目明细/反馈
frontend/src/styles/views-admin.css                   # vw-brief__pick / __theme / __drawer
```

## API 契约（新增，错误格式沿用 `{error:{code,message}}`）

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/briefing/runs/{id}` | 跑批明细 + 条目列表（`{run, items:[...]}`），`404` 表示不存在或越空间 |
| `GET` | `/api/briefing/items?runId=&theme=&minScore=&q=&page=1&size=20` | 分页条目，默认按 `quality_score DESC`；`page/size` 夹在合理范围 |
| `POST` | `/api/briefing/items/feedback` | `{url, feedback:"useful"\|"not_interesting"}` → 200 + `{ok:true}`；同 URL 同用户幂等覆盖 |

所有响应字段 camelCase；条目字段：`{url, title, summary, source, theme, qualityScore, accepted, rank, keyPoints, whyItMatters, relatedNoteTitles}`。

## Code Style

- 新字段一律**追加**，不删改既有响应字段（Hyrum's Law）。
- 反馈是用户数据写入：同一 `(space_id, user_id, url)` 唯一，重复提交覆盖而非新增。
- 外部内容/AI 输出只作为数据显示，不进 prompt、不执行。

## Testing Strategy

| 层级 | 覆盖 |
|---|---|
| 单元 | 主题分类（AI 标签优先 → 规则关键词兜底）、Top5 排序（质量分优先，反馈轻微加权）、相关度计算 |
| 集成 MockMvc | runs/{id} 404 与越空间；items 分页/筛选；反馈幂等覆盖 |
| 简报生成回归 | 新增 note 排版断言（若确认改 note）；旧笔记不受影响 |
| 前端 harness | mock 增加 items/feedback 端点；四断点截图；无 console 错误 |
| 全量 | 后端 416+ 全绿、前端 tsc 通过 |

## Boundaries

- **Always**：低质量条目仍写进 note 附录；反馈幂等；分页上限；按 space 隔离；新 API 字段可空兼容旧客户端。
- **Ask first**：改变简报 note 排版、创建/删除用户笔记、把 KB 内容发给外部 AI。
- **Never**：因为反馈直接删除历史条目或笔记；默认把用户笔记内容发外部服务；在 AI 失败时让简报生成失败。

## Success Criteria

1. 每次 run 把入选条目写入 `briefing_items`（含质量分、主题、排名）；旧 run 不影响。
2. 「今日必读」只取 `qualityScore ≥ 70` 的条目，最多 5 条；不足 5 条时按实际数量展示，不凑数。
3. 主题聚类：优先 AI `tags`，无 AI 时按关键词映射到固定 5 类（模型 / 产品 / 研究 / 政策 / 工具）。
4. 本地个性化：用 `RelatedService` 找最多 3 篇相关笔记标题，展示「与你已有的《X》相关」；**默认开启但纯本地计算**，不发外部请求。
5. 反馈写入幂等，同用户对同 URL 改主意只留一条记录。
6. 前端支持：Top5 卡片、主题筛选、搜索、分页、条目详情抽屉、有用/不感兴趣按钮、URL 状态记忆。
7. 全量测试与构建通过；四断点截图无溢出、无 console 错误。

## Out of Scope (Deferred)

- 一键「存进知识库」新建笔记（有用户数据副作用，另起 delta spec）
- AI prompt 携带用户 KB 内容（隐私，另起 delta spec，默认关闭）
- 邮件/Webhook 推送、跨周对比、周报形态（属于 `weekly-experience`）

## Open Questions（已全部确认 2026-11-22）

1. **note 排版 = 只改网页视图**：`BriefingRenderer` 与已生成笔记**完全不动**；Top5 / 主题 / 反馈只出现在 `#/briefing`。
2. **主题分类**：AI tags 优先，无 AI 时用规则关键词映射到固定 5 类（模型 / 产品 / 研究 / 政策 / 工具）。
3. **本地个性化**：默认开启，用 `RelatedService` 在本地 DB 算相关笔记标题，不外发任何内容；可配置关闭。
4. **反馈动作**：V1 只有「有用 / 不感兴趣」，同 URL 幂等覆盖；不做一键新建笔记。

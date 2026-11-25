# P1 实施计划 — 内容质量跃迁

规格：`spec/SPEC-quality-gate.md`（已确认）；能力地图：`spec/capability-map.md`（已确认）。

## 当前模块：`quality-gate`

| 切片 | 内容 | 依赖 | 验证点 |
|---|---|---|---|
| 1 | `QualityInput` / `QualityRule` / 五条规则 + 纯单测 | — | 规则单测红灯→绿灯；阈值 70 生效 |
| 2 | `QualityGate` 编排 + `QualityProperties`（可配模板句/阈值） | 1 | 评分聚合测试、配置绑定测试 |
| 3 | `content_quality` 表 + Repository + 只读报告 API | 2 | 迁移幂等、空间隔离、报告聚合集成测试 |
| 4 | 接入简报生成：渲染前评分，低分降级保留不丢弃 | 1–3 | `BriefingApiTest` 回归、新增降级断言 |
| 5 | `docs/QUALITY.md` + 全量回归 + 真实运行报告 | 1–4 | 385+ 测试全绿、报告接口返回真实数据 |

## 风险与对策

- **误伤中文/正常摘要**：规则只硬拒绝明确坏模式（null、实测套话、截断+短、LaTeX）；重复只降级不拒绝；阈值 70 可配。
- **改坏现有简报流程**：切片 4 保持 `BriefingRenderer` 输入结构不变，只在写入前附加质量标记；回归测试覆盖。
- **报告扫描开销**：只扫 `briefing_cache`（每 URL 一行），默认 limit 50，不扫正文大字段。
- **多用户串数据**：`content_quality` 主键含 `space_id`，所有查询强制带空间条件。

## 后续模块（本轮不做）

`ai-analysis` → `briefing-experience` → `weekly-experience`，各自单独写 spec 后再实现。

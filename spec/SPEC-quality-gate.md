# Spec: 内容质量闸门（quality-gate）— V1

## Objective

把「截断摘要 / 模板套话 / null 译文 / 未清理 LaTeX / 跨源重复」的条目挡在渲染之前，并给出**可解释的质量分**。

用户价值：
- 不再出现 `XX 在 Hugging Face 上发布的博客文章` 这类无信息量摘要；
- 不再把 `title_zh/summary_zh` 为 null 的翻译失败结果当作成功缓存；
- 每条内容有 0–100 分和可说明的扣分理由，为后续「今日必读」排序与反馈闭环提供基础。

## Tech Stack

- Java 21 + Spring Boot 4.1 + JdbcTemplate + SQLite（沿用现有后端栈）
- JUnit 5 + MockMvc（项目既有测试体系）
- 不引入新依赖；规则用纯 Java + 正则实现

## Commands

```
# 单模块测试（本模块）
cd backend && .\mvnw.cmd -B -Dtest=BriefingQualityGateTest,QualityReportApiTest test

# 全量回归
cd backend && .\mvnw.cmd -B test

# 前端（本模块不涉及 UI，仅确认未破坏类型）
cd frontend && node node_modules\typescript\bin\tsc -b --pretty false
```

## Project Structure

```
backend/src/main/java/com/kb/quality/
    QualityGate.java        # 编排：应用规则 → 打分 → 输出结论
    QualityResult.java      # score / accepted / reasons / normalizedText
    QualityRule.java        # 规则接口（纯函数，便于单测）
    rules/                  # 具体规则：NullRule, BoilerplateRule, TruncationRule, LatexRule, DuplicateRule
    QualityReportRepository.java  # 结果持久化与历史报告查询
backend/src/main/java/com/kb/quality/QualityController.java  # 只读报告端点
backend/src/test/java/com/kb/quality/                        # 规则单测 + API 集成测试
docs/QUALITY.md             # 规则清单、阈值、扣分理由说明
```

## Code Style

```java
public record QualityResult(int score, boolean accepted, List<String> reasons, String normalizedText) {}

// 规则是纯函数：输入文本，输出扣分与理由，不产生副作用
public interface QualityRule {
    String id();
    int penalty(String text);          // 0 = 通过
    default String reason() { return id(); }
}
```

- 包名、命名、缩进沿用 `com.kb.briefing` 现有风格；中文注释解释「为什么」，不解释「做了什么」。
- SQL 一律参数化；时间统一 `Times.now()`；新表带 `space_id` 隔离。

## Testing Strategy

| 层级 | 覆盖 |
|---|---|
| 单元（主要） | 每条规则的通过/命中边界：null、空白、模板句、以「……」结尾且过短、`\textbf{}`、近似重复 |
| 单元 | 评分聚合：多规则叠加、分数下限 0、accepted 阈值一致 |
| 集成 | 质量结果落表与按空间隔离；`GET /api/quality/report` 返回历史不合格计数 |
| 回归 | 现有 `BriefingApiTest` / `BriefingCacheTest` 全绿，简报生成默认行为不变 |

测试命令见上；所有测试不得发真实网络请求。

## Boundaries

- **Always**：先写失败测试再实现；规则可解释（扣分理由必须能展示给用户）；SQL 参数化；外部文本一律视为不可信数据。
- **Ask first**：新增数据库表、新增 API 端点、修改 `briefing_runs` 等既有表结构、新增任何依赖。
- **Never**：默认调用任何外部 AI；自动改写或删除历史笔记；把不合格条目直接丢弃（只降级，不丢信息）。

## Success Criteria

1. `title_zh` 或 `summary_zh` 为 null/空白 → score 0、accepted=false。
2. 命中模板句（可配置，默认含「在 Hugging Face 上发布的博客文章」「我们正在通过开源和开放科学」等实测套话）→ 扣分至拒绝。
3. 摘要以 `……`/`...` 结尾且长度 < 40 字 → 拒绝。
4. 含 `\textbf{` / `\frac{` 等 LaTeX 残留 → 拒绝。
5. 同一 run 内与前序条目 5-gram Jaccard > 0.8 → 判为近似重复并降级。
6. 合格条目得 0–100 分；**≥70** 才进入「今日必读」候选，其余仍写入简报但标记低质量（降级保留，不丢信息）。
7. 结果落 `content_quality(space_id, module, target_key, score, accepted, reasons, checked_at)`，按空间隔离。
8. `GET /api/quality/report?module=briefing` 返回最近 N 条不合格统计与理由分布（只读，不改历史笔记）。
9. 现有 385 项后端测试与 41 项简报 UI 断言保持全绿。

## Out of Scope (Deferred)

- AI 参与打分 / 结构化分析 → `ai-analysis` 模块
- 「今日必读」排序、主题聚类、反馈按钮、个性化 → `briefing-experience` 模块
- 周报深度解读与项目档案 → `weekly-experience` 模块
- 历史英文简报批量重译：本模块只提供**只读报告**，不自动改写历史笔记
- 邮件 / Webhook 推送

## Open Questions

1. ~~阈值~~ **已定：≥70 进「今日必读」候选**（用户 2026-11-22 确认）。
2. ~~模板句清单~~ **已定：`kb.quality.template-patterns` 可配置 + 默认实测清单**（用户确认）。
3. ~~不合格条目~~ **已定：降级保留，只在 Top 区排除，不丢信息**（用户确认）。
4. ~~历史数据处理范围~~ **已定：V1 只出只读报告，不自动重译/改写历史简报**（用户 2026-11-22 确认）；历史修复另起 delta spec。
5. 质量分是否需要按用户反馈动态调整？（V1 不做，留给 `briefing-experience` 的反馈闭环）

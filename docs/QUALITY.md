# 内容质量闸门（P1 / quality-gate）

> 规格：`spec/SPEC-quality-gate.md`；能力地图：`spec/capability-map.md`。

## 它解决什么

真实库里出现过四类无效内容：`title_zh/summary_zh` 为 null 却当成功缓存、模板套话（「XX 在 Hugging Face 上发布的博客文章」）、`……` 截断短摘要、未清理的 LaTeX（`\textbf{}`）。质量闸门在渲染前给每条内容打分，让后续「今日必读」只取高质量条目。

## 规则与扣分

| 规则 id | 命中条件 | 扣分 |
|---|---|---|
| `missing_text` | 标题或摘要为 null / 空白 | 100 |
| `boilerplate` | 命中 `kb.quality.template-patterns`（内置实测清单 + 用户追加，正则、大小写不敏感） | 100 |
| `truncated` | 摘要以 `……` / `...` 结尾且长度 < 40 字 | 100 |
| `latex_residue` | 含 `\textbf{` / `\frac{` / `\begin{` 等 LaTeX 命令 | 100 |
| `near_duplicate` | 与前序条目 5-gram Jaccard > 0.8 | 60 |

得分 = `max(0, 100 - 累计扣分)`。**≥70 分才进入「今日必读」候选**；低分条目仍完整保留在正文，只降级不丢弃。

## 配置

```properties
kb.quality.enabled=true
kb.quality.threshold=70
kb.quality.template-patterns=        # 追加项，逗号分隔的正则；内置清单始终保留
kb.quality.report-limit=50
```

## 数据流

1. 简报生成：抓取 → 富化 → `buildBlocks` → `scoreIncludedItems()` 用**富化后的最终文本**评分 → 结果写 `content_quality(space_id, module, target_key, score, accepted, reasons, checked_at)`。
2. 报告：`GET /api/quality/report?module=briefing&limit=50` 扫描 `briefing_cache`，逐条评分并落表，返回 `{module, scanned, downgraded, averageScore, reasons[], samples[]}`。
3. 报告**只读**：不改历史笔记、不自动重译、不删除任何内容。历史修复另起 delta spec。

## 错误语义

- `module` 非 `briefing` → 400 `VALIDATION_FAILED`（与既有接口统一 `{error:{code,message}}` 格式）。
- 未登录 → 401；报告数据严格按 `space_id` 隔离。

## 测试

```
cd backend && .\mvnw.cmd -B -Dtest=QualityRuleTest,QualityGateTest,QualityReportApiTest,BriefingApiTest test
cd backend && .\mvnw.cmd -B test
```

规则是纯函数单测（无网络/DB）；报告是 MockMvc 集成测试；简报回归测试断言「评分落表 + 15 条内容一条不少」。

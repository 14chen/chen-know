# Capability Map: 简报/周报内容质量跃迁（P1）

> 状态：待用户确认模块边界与构建顺序。确认后逐模块走 Specify → Plan → Tasks → Implement。

| Module id | 职责 | Depends on |
|---|---|---|
| `quality-gate` | 摘要/标题质量规则、可解释评分、跨源近似去重、质量结果持久化与历史报告 | — |
| `ai-analysis` | 可插拔结构化 AI 分析（OpenAI-compatible / Ollama，默认关闭）、分析缓存、AI 失败降级 | `quality-gate` |
| `briefing-experience` | 今日必读 Top5、主题聚类、条目明细 API、反馈、基于用户知识库的个性化 | `quality-gate`, `ai-analysis`（运行时可选） |
| `weekly-experience` | 一份周报总览 + Top3 深度解读 + 项目档案跨周积累 + 真实星增趋势 | `quality-gate`, `ai-analysis`（运行时可选） |

**构建顺序**：`quality-gate` → `ai-analysis` → `briefing-experience` → `weekly-experience`

**依赖方向说明**
- 质量能力是公共底座，但只放被两个模块共用的规则与评分；简报/周报各自的业务规则留在各自模块，不反向依赖 UI。
- `ai-analysis` 只产出结构化结果与置信度，**不直接决定展示**；展示层消费质量分 + 分析结果后再决策。
- AI provider 默认 `none`，未配置 key / 本地模型时全部链路按现有行为运行（不阻断生成、不额外收费）。

**每个模块单独交付**：有自己的 spec、测试、验证证据；一个模块完成并验证后再开下一个。

# 每日 AI 简报 · 本轮冻结契约

> 用户需求：「把这些源做成每日 AI 简报自动归档进知识库，附带原地址链接，长期项目」。
> 已拍板：**归档到 14chen 账号 / 每天 18:30 / 每源前 5 条 / 不翻墙（用已验证可达的源）**。

---

## 1. 源清单（★ 全部由 Lead 实测过状态码与真实数据格式）

| # | 源 | URL（实测可用） | 形态 | 备注 |
|---|---|---|---|---|
| 1 | OpenAI | https://openai.com/news/rss.xml | RSS | 1318 条；title/link/description 均带 CDATA |
| 2 | Google DeepMind | https://deepmind.google/blog/rss.xml | RSS | 干净 item，含 pubDate |
| 3 | Hugging Face | https://huggingface.co/blog/feed.xml | RSS | |
| 4 | Techmeme | https://www.techmeme.com/feed.xml | RSS | description 是 HTML 富文本，内含 A HREF 指向原文；**需提取真实原文链接** |
| 5 | Import AI | https://www.importai.net/feed | RSS | substack 域名被封，**必须用 importai.net** |
| 6 | 量子位 | https://www.qbitai.com/feed | RSS | 标准 item，含多个 category |
| 7 | Hacker News | https://hn.algolia.com/api/v1/search?query=AI&tags=story&hitsPerPage=N | JSON | 取 hits[].title / url / points / created_at |
| 8 | Anthropic | https://www.anthropic.com/news | HTML | **必须带浏览器 UA**（不带会被拒）；RSS 端点实测不可用 |
| 9 | arXiv cs.AI | https://arxiv.org/list/cs.AI/recent | HTML | **export.arxiv.org API 域名被封**，只能抓列表页 |
| 10 | 机器之心（可选） | https://www.jiqizhixin.com/ | HTML | **实测 /rss 返回的是 HTML 页面，不是 RSS** |

**已实测不可用，不要浪费时间**：reddit.com 全变体超时、reddit 的 .rss、news.google.com/rss、importai.substack.com、anthropic.com/rss.xml、bing news 的 format=rss（返回 HTML）、deeplearning.ai/the-batch/feed/。

**统一要求**：
- 所有请求带 User-Agent: Mozilla/5.0 … AppleWebKit/537.36 与 Accept-Language，超时 **15s**
- 只走 HTTPS；最多跟随 3 次重定向
- 单个源失败**绝不影响其他源**，失败原因记进简报末尾

---

## 2. 数据模型（新增两张表，写进 SchemaMigrator）

~~~sql
CREATE TABLE IF NOT EXISTS briefing_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id      INTEGER NOT NULL,
  started_at    TEXT    NOT NULL,
  finished_at   TEXT,
  status        TEXT    NOT NULL,           -- running | success | partial | failed
  note_id       INTEGER,                    -- 生成的笔记 id（失败为 NULL）
  total_items   INTEGER NOT NULL DEFAULT 0,
  new_items     INTEGER NOT NULL DEFAULT 0,
  source_report TEXT    NOT NULL DEFAULT '[]',  -- JSON 数组: {source,ok,count,error}
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_briefing_runs_space ON briefing_runs(space_id, started_at DESC);

CREATE TABLE IF NOT EXISTS briefing_seen (
  space_id      INTEGER NOT NULL,
  url           TEXT    NOT NULL,
  first_seen_at TEXT    NOT NULL,
  PRIMARY KEY (space_id, url)
);
~~~

- briefing_seen 是**跨天去重**的依据：已出现过的 url 下次不再收录
- 软删除/回收站不参与去重判定（保留历史，避免重复刷屏）

---

## 3. 去重语义（必须精确实现）

1. 抓到的条目先按 url 规范化（去 #fragment、去 utm_* / fbclid / ?ref= 等跟踪参数）后**批内去重**
2. 再与 briefing_seen 比对，**已见过的丢弃**
3. **同一源最多 5 条**（按源内顺序或时间倒序取前 5）
4. 收录成功后才写入 briefing_seen
5. **若某天所有源都没有新内容** → 仍然写一条极短的简报（今天没有新的 AI 资讯），并注明「本次共检查 N 条，全部已收录过」
   —— **不要静默不写**，否则用户无法区分「没新内容」和「任务挂了」

---

## 4. 简报正文格式（Markdown）

~~~markdown
# AI 简报 2026-10-18

> 生成于 2026-10-18 18:30 · 新内容 34 条（检查 168 条，已收录过 134 条）

## 国外 · 一手

### OpenAI
1. [标题](原始链接) — 一句话摘要
2. …

### Anthropic
…

## 国外 · 快讯

### Techmeme
…

### Hacker News
- [标题](链接) · 128 分

## 国内

### 量子位
…

## 研究

### arXiv cs.AI
…

---

### 本次未取到
- Anthropic：HTTP 403（可能被 UA/地区限制）
- 机器之心：解析失败（页面结构变化）
~~~

**硬性要求**：
- **每条都必须有原始链接**，链接必须是浏览器可直接打开的绝对 URL
- 链接文字用标题；摘要**去掉 HTML 标签、折叠空白、截断到 120 字**
- 正文里**不得出现未转义的 HTML 标签**（会被我们编辑器渲染，干扰阅读）
- 分组标题稳定，便于以后解析

---

## 5. 后端结构（com.kb.briefing 新包）

| 类 | 职责 |
|---|---|
| BriefingProperties | 读 kb.briefing.*（enabled / owner / cron / per-source / folder / tags） |
| BriefingScheduler | @Scheduled 触发；**cron 可配**，默认 0 30 18 * * * |
| BriefingService | 编排：解析 owner→userId/spaceId → 抓取 → 去重 → 渲染 → 写笔记 → 记录 run |
| BriefingFetcher | 接口 List<RawItem> fetch(int limit)；每个源一个实现 |
| RawItem | record(title, url, summary, source, score, publishedAt) |
| BriefingRenderer | 生成 Markdown（**纯函数**，便于单测） |
| BriefingRepository | runs / seen 的读写 |
| BriefingController | POST /api/briefing/run、GET /api/briefing/runs、GET /api/briefing/sources |

**要点**：
- 需要 @EnableScheduling（加在 KnowledgeBaseApplication 或配置类）
- **HTTP 用 JDK 自带 java.net.http.HttpClient**（不要引入新依赖）
- XML 解析用 JDK 自带 javax.xml.parsers，**必须禁用 DTD 与外部实体（防 XXE）**
- 写笔记复用 NoteService.create(userId, spaceId, request)，不要自己拼 SQL
- 归属目录按名字查找；仍没有就用 folderId=null（**不要自动建目录**，避免污染目录树）
- **抓取与解析必须可注入**：单元测试用固定样本，**测试里绝不允许发真实网络请求**

## 6. API 契约

~~~
POST /api/briefing/run            -> 200 { runId, status, totalItems, newItems, noteId, sourceReport }
GET  /api/briefing/runs?limit=10  -> 200 { items:[{id,startedAt,finishedAt,status,totalItems,newItems,noteId,sourceReport}] }
GET  /api/briefing/sources        -> 200 { items:[{id,name,url,kind}] }
~~~

- POST /run 需要登录；**只允许归档到自己所在空间**（不接受 spaceId 参数）
- 并发保护：同一 space 同时只允许一个 run，第二个返回 409 CONFLICT

## 7. 前端（views/briefing/index.tsx）

路由 #/briefing，标题「AI 简报」：

1. 顶部操作：「立即生成简报」按钮（点击后回显进度与结果）
2. **源状态表**：源名 / 类型（RSS/HTML/JSON）/ 链接（可点，新窗口）
3. **运行历史表**：时间 / 状态 / 新内容条数 / 检查条数 / 跳转到生成的笔记
4. 三态：加载骨架屏 / 空态（还没跑过）/ 错误态（带重试）
5. **四断点无横向溢出**；触摸设备按钮 ≥44×44

---

## 8. 文件所有权

| 范围 | 归属 |
|---|---|
| backend/src/main/java/com/kb/briefing/** | **kb-ext-api** |
| backend/src/main/java/com/kb/db/SchemaMigrator.java（仅追加 DDL） | **kb-ext-api**（已授权） |
| backend/src/main/java/com/kb/KnowledgeBaseApplication.java（仅加 @EnableScheduling） | **kb-ext-api** |
| backend/src/test/java/com/kb/briefing/** | **kb-ext-api** |
| frontend/src/views/briefing/**、styles/views-admin.css（仅简报样式段） | **kb-web-admin** |
| application.properties（追加 kb.briefing.*） | **kb-ext-api** |
| docs/** | **Lead** |

**共同禁止**：修改既有业务逻辑（note/folder/tag/search/trash/attachment/ioport）、api/types.ts、views/types.ts、package.json、vite.config.ts、tsconfig*。

---

## 9. 验收标准（必须贴真实输出）

**后端**
1. **真实抓取**：至少 6 个源实际联网跑一次，贴每源取到几条 + 首条标题与链接
2. **生成的笔记**：正文 ≥20 条、每条都有可点链接（抽 5 条用 curl 验证链接返回 200/3xx）
3. **去重**：连续跑两次，第二次 newItems 接近 0，且不生成重复内容
4. **单源失败不致命**：人为把某源 URL 改无效，其余源仍正常、简报末尾出现「本次未取到」
5. **并发保护**：两个并发 POST /run，一个 200 一个 409
6. **定时触发**：cron 配成 1 分钟后，实际等到自动生成（贴 run 记录）
7. **目录与标签**：笔记落在配置的目录、带上配置的标签
8. **单元测试不发网络请求**（用会抛异常的 fake HTTP 客户端验证）
9. mvnw -B test 全绿（基线 193，只允许增加）

**前端**
10. #/briefing 三态齐全；「立即生成」能真的触发并回显结果
11. 源状态表里每个链接可点且指向正确 URL
12. 运行历史能看到刚才的 run，且能跳到对应笔记
13. 四断点无横向溢出；390px 触摸目标 ≥44px

**安全**
14. XXE：喂一个带外部实体的 XML，不得读取本地文件（贴测试用例）
15. 简报正文里不得出现未转义 HTML 标签

---

## 10. 环境

- **测试实例端口 8090**，数据目录用临时目录（**绝不能用仓库 data/ 下的真实库**）
- ⚠️ **用户真实实例在 8081 运行中；8080 是另一个应用（spm.jar）—— 两个都绝对不要碰、不要停**
- ⚠️ **jar 可能被 8081 锁住**：打包用 -Dkb.finalName=kb-briefing-verify（pom 已支持），**报 Unable to rename 立刻停手汇报**
- 验收时把 kb.briefing.owner 配成临时库里的账号（如 demo），**不要往 14chen 的真实空间写测试数据**

---

## 11. 优化要求（用户原话「有优化的地方就优化」）

- **抓取并发**：多源并行（虚拟线程或固定线程池），总耗时从串行 ~60s 压到 <15s
- **失败可诊断**：每源失败原因要具体（超时 / HTTP 码 / 解析失败 / 0 条），不要笼统「失败」
- **同 run 内不重复请求同一 URL**
- **渲染纯函数**：无副作用、可单测、排序稳定（同内容两次渲染字节一致）
- **日志**：一次 run 一行摘要（INFO），逐源明细用 DEBUG，不要把正文打进日志
- **缓存一致性（P0 已修）**：翻译失败不再写死进 `briefing_cache`（`translation_failed=1` 下次重试）；文章页/配图与译文统一在富化末尾一次回写，避免两条提前返回路径漏写；缓存按 `cache-ttl-days` 过期、按 `cache-retention-days` 清理，去重台账按 `seen-retention-days` 清理
- **调度隔离（P0 已修）**：`application.properties` 配 `spring.task.scheduling.pool.size=3`，简报 / 周报 / 归档三个任务不再抢同一个默认单线程

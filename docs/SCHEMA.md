# SCHEMA.md — 数据模型契约（冻结版 v1）

> 本文件是**唯一真源**。任何子代理不得擅自改动表结构；如发现缺陷，回报给 Lead，由 Lead 修订本文件并通知全部相关方。

## 0. 全局约定

| 项 | 约定 |
|---|---|
| 数据库 | SQLite 单文件 `data/kb.db`，通过 `org.xerial:sqlite-jdbc` 内嵌访问 |
| 连接 PRAGMA | `journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`、`synchronous=NORMAL` |
| 时间格式 | 一律 `TEXT`，ISO-8601 UTC，形如 `2026-10-16T02:33:14Z`（`DateTimeFormatter.ISO_INSTANT`） |
| 时间戳统一入口 | **必须**用 `com.kb.common.Times.now()`。JDK21 实际输出纳秒精度 `2026-10-15T17:04:01.095217300Z`，**各模块若混用不同精度，`ORDER BY updated_at DESC` 的字典序会出错** |
| 主键 | 一律 `INTEGER PRIMARY KEY AUTOINCREMENT` |
| 软删除 | 以 `deleted_at IS NULL` 表示存活；所有查询**必须**显式带上该条件 |
| 多租户隔离 | 除 `users`/`invites`/`settings` 外，每张业务表都归属某个 `space_id`。**任何 SQL 都不得跨 space 读写** |
| 命名 | 表名/列名 `snake_case`；Java 字段 `camelCase` |

## 1. 建表 DDL

```sql
-- ========== 账号体系 ==========
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,                      -- BCrypt，强度 10
  role          TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL
);

CREATE TABLE invites (
  code       TEXT    PRIMARY KEY,                      -- 32 位随机十六进制
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT,                                     -- NULL = 永不过期
  used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at    TEXT
);

-- 一个用户一个空间；为将来「共享空间」预留 owner_id 语义
CREATE TABLE spaces (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);

-- ========== 目录树 ==========
CREATE TABLE folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id   INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,   -- NULL = 根
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_folders_space ON folders(space_id, parent_id, deleted_at);

-- ========== 笔记 ==========
CREATE TABLE notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id    INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  folder_id   INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  title       TEXT    NOT NULL DEFAULT '',
  content     TEXT    NOT NULL DEFAULT '',            -- Markdown 原文
  excerpt     TEXT    NOT NULL DEFAULT '',            -- 剥离 Markdown 语法后的纯文本前 200 字
  search_blob TEXT    NOT NULL DEFAULT '',            -- 见 §2，供 FTS5 使用
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_pinned   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX idx_notes_space  ON notes(space_id, deleted_at, is_pinned DESC, updated_at DESC);
CREATE INDEX idx_notes_folder ON notes(folder_id, deleted_at);

CREATE TABLE note_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (note_id, version)
);
CREATE INDEX idx_versions_note ON note_versions(note_id, version DESC);

-- ========== 标签 ==========
CREATE TABLE tags (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  color    TEXT    NOT NULL DEFAULT '#6b7280',
  UNIQUE (space_id, name COLLATE NOCASE)
);

CREATE TABLE note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX idx_note_tags_tag ON note_tags(tag_id);

-- ========== 双向链接 ==========
-- 出链：从 source 笔记正文解析 [[目标标题]] 得到
CREATE TABLE links (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id       INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_title   TEXT    NOT NULL,                     -- 原文标题，可能尚未创建
  target_note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL,
  UNIQUE (source_note_id, target_title)
);
CREATE INDEX idx_links_target ON links(target_note_id);
CREATE INDEX idx_links_title  ON links(space_id, target_title COLLATE NOCASE);

-- ========== 附件 ==========
CREATE TABLE attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id      INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  note_id       INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  stored_name   TEXT    NOT NULL UNIQUE,               -- 磁盘相对路径，形如 "7/3f2a....png"
  original_name TEXT    NOT NULL,
  mime_type     TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);
CREATE INDEX idx_attach_space ON attachments(space_id, created_at DESC);

-- ========== 行为日志（最近浏览 / 统计） ==========
CREATE TABLE activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id    INTEGER REFERENCES notes(id) ON DELETE CASCADE,
  action     TEXT    NOT NULL CHECK (action IN ('view','create','edit','delete','restore','import','export')),
  created_at TEXT    NOT NULL
);
CREATE INDEX idx_act_user ON activities(user_id, created_at DESC);
CREATE INDEX idx_act_note ON activities(user_id, note_id, created_at DESC);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## 2. 中文全文检索策略（已实测验证）

**结论：CJK 逐字加空格 + `unicode61` + 短语查询。不使用 `trigram`。**

- `trigram` 要求查询长度 ≥ 3 字符，而中文常用词大量为 2 字（「天气」「笔记」），直接不可用。
- `unicode61` 直接索引中文时，一整串连续汉字会被当作**单个 token**，搜「天气」匹配不到「今天天气很好」。

**做法**：写入 `notes.search_blob` 前，把文本中的每个 CJK 字符用空格隔开，拉丁字母/数字原样保留：

```
原文：今天天气很好，Spring Boot 笔记 v2
blob：今 天 天 气 很 好 ， Spring Boot 笔 记 v2
```

查询时对用户输入做同样归一化，再把连续 CJK 段包成**短语**：

```
用户输入 天气        -> MATCH '"天 气"'
用户输入 spring boot -> MATCH 'spring boot'
用户输入 Spring笔记  -> MATCH 'Spring "笔 记"'
```

因为 `"天 气"` 是短语查询，FTS5 要求 token 连续出现，等价于中文字符串的**子串精确匹配**，1 字查询同样有效。

**归一化函数必须前后端/写入读出共用同一份实现**，放在 **`com.kb.common.SearchText`**（v1 修订：原写 `com.kb.search` 是笔误，已实现为 `com.kb.common`，`com.kb.search` 包留给搜索 API）：

```java
// 伪码，实现者照此落地
static String normalize(String text)     // 生成 search_blob
static String toMatchExpression(String q) // 生成 FTS5 MATCH 表达式；用户输入需转义双引号
```

FTS5 表与触发器（external content，正文只存一份）：

```sql
CREATE VIRTUAL TABLE notes_fts USING fts5(
  search_blob,
  content='notes',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, search_blob) VALUES (new.id, new.search_blob);
END;
CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, search_blob) VALUES ('delete', old.id, old.search_blob);
END;
CREATE TRIGGER notes_fts_au AFTER UPDATE OF search_blob ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, search_blob) VALUES ('delete', old.id, old.search_blob);
  INSERT INTO notes_fts(rowid, search_blob) VALUES (new.id, new.search_blob);
END;
```

**索引重建**（首次迁移或数据修复时）：`INSERT INTO notes_fts(notes_fts) VALUES('rebuild');`

> ⚠️ **external content 表的三条实测陷阱**（v1 修订，由 kb-backend-core 实测发现）：
> 1. `SELECT COUNT(*) FROM notes_fts` 返回的是**内容表 `notes` 的行数**，不是索引里的行数。索引被抹掉后该值依然是 1。**不能用 COUNT 判断索引是否健康**。
> 2. `INSERT INTO notes_fts(notes_fts) VALUES('integrity-check')` **探测不到索引行缺失**。
> 3. 判断索引是否可用**只能用 `MATCH` 查询**；`rebuild` 是唯一可靠的修复手段。
> 因此 `VERIFY.md` E12 已改为 MATCH 断言，不再用 COUNT 对比。

> ⚠️ **不要用 `snippet()` / `highlight()`**：它们返回的是归一化后的 blob（汉字之间带空格），不适合展示。搜索高亮由 Java 在 `notes.content` 原文上自行计算，返回 `<em>` 标记。

搜索 SQL 骨架（必须 JOIN 回 notes 以过滤软删除与空间）：

```sql
SELECT n.id, n.title, n.excerpt, n.folder_id, n.updated_at, bm25(notes_fts) AS score
FROM notes_fts
JOIN notes n ON n.id = notes_fts.rowid
WHERE notes_fts MATCH :expr
  AND n.space_id = :spaceId
  AND n.deleted_at IS NULL
ORDER BY score
LIMIT :size OFFSET :offset;
```

## 3. 软删除与级联语义（必须严格实现）

| 操作 | 语义 |
|---|---|
| 删除笔记 | `notes.deleted_at = now`；其 `links` 出链保留，`note_tags` 保留（恢复后标签还在） |
| 删除文件夹 | 用递归 CTE 取出该文件夹及**全部子孙文件夹**，连同其中所有笔记一并置 `deleted_at` |
| 恢复文件夹 | 恢复该文件夹及子孙，以及**当初随它一起被删的**笔记（同一次操作时间戳相同的）。**并额外恢复其祖先目录链（只恢复目录本身，不恢复祖先里的笔记）** —— 见下方说明 |
| 彻底删除笔记 | `DELETE FROM notes`，级联清掉 `note_tags`/`links`/`note_versions`；磁盘附件保留但解除关联 |
| 清空回收站 | 彻底删除当前空间全部 `deleted_at IS NOT NULL` 的笔记与文件夹 |

递归 CTE 取子树：

```sql
WITH RECURSIVE sub(id) AS (
  SELECT :folderId
  UNION ALL
  SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
)
SELECT id FROM sub;
```

> **为什么恢复时还要恢复祖先链**（v1 修订，实现中发现的数据安全缺陷）：
> 若只恢复子树，会出现「**存活的目录挂在已删除的父目录下**」——该子树在目录树里不可见，
> 而一旦对已删父目录做 `POST /api/trash/empty` 或彻底删除，`ON DELETE CASCADE` 会**连带删掉这些刚恢复的存活数据**。
> 因此恢复子目录时必须把祖先目录链一并恢复（仅目录，祖先目录里的笔记保持原删除状态）。
> 这条是被实测出的数据丢失路径，不是可选优化。

## 4. 不变量（自测必须覆盖）

1. 任意用户 A 的 token 无法读到用户 B 的任何笔记/目录/标签/附件（跨空间越权测试）
2. 保存笔记后 `notes.version` 自增，且 `note_versions` 新增一行旧内容
3. 更新笔记后 `search_blob` 同步更新，搜新词能命中、旧词不再命中
4. 软删除的笔记不出现在列表与搜索结果中；恢复后重新出现
5. 删除文件夹后其子孙文件夹与其中笔记全部进入回收站
6. `notes_fts` 行数与 `notes` 行数始终一致（`rebuild` 可修复）
---

## 5. 每日 AI 简报（第六轮新增，追加式迁移不改动既有表）

`SchemaMigrator` 在执行完既有 DDL 后追加**这 6 张表**（幂等，重复执行无副作用）。

> **v1 修订（2026-10-28）**：本文件此前只登记了 `briefing_runs` 与 `briefing_seen` 两张，而 `SchemaMigrator.BRIEFING_DDL` 实际建 **6 张**（另有 `archive_runs`、`repo_star_snapshots`、`weekly_runs`、`briefing_cache`）。缺失的 4 张已补在 §5.4（缺陷 DEF-E5-003）。
它们**不存简报正文** —— 简报就是一篇普通笔记，走 `NoteService.create`，因此继承全部既有能力（搜索 / 版本 / 标签 / 导出）。

### 5.1 `briefing_runs` —— 每次抓取运行的记录

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `space_id` | INTEGER NOT NULL | 归属空间；查询始终带它 |
| `started_at` / `finished_at` | TEXT | ISO-8601 UTC |
| `status` | TEXT NOT NULL | `running` / `success` / `partial` / `failed` |
| `note_id` | INTEGER | 生成的笔记 id；失败为 NULL |
| `total_items` | INTEGER | 本次检查到的条目总数 |
| `new_items` | INTEGER | 去重后实际收录数 |
| `source_report` | TEXT NOT NULL DEFAULT `'[]'` | JSON **数组**：`[{source,ok,count,error}]` |
| `error` | TEXT | 整体失败原因 |

索引：`idx_briefing_runs_space(space_id, started_at DESC)`。

### 5.2 `briefing_seen` —— 跨天去重台账

| 列 | 类型 | 说明 |
|---|---|---|
| `space_id` | INTEGER NOT NULL | 复合主键之一 |
| `url` | TEXT NOT NULL | 规范化后的原文链接（去 `#fragment` 与 `utm_*` / `fbclid` / `?ref=`） |
| `first_seen_at` | TEXT NOT NULL | |

主键 `(space_id, url)`，天然防同一空间重复收录。

### 5.3 不变量（简报相关）

7. `briefing_seen` 中不存在重复的 `(space_id, url)`；同一 URL 在同一空间只会被收录一次
8. 同一空间同时只允许一个 `status='running'` 的 run（第二个请求返回 409）
9. `briefing_runs.status` 取值恒在四值之内；`note_id` 非 NULL 时对应笔记必须存在
10. **简报表与用户笔记解耦**：删掉服务运行记录不影响任何笔记；删掉简报笔记不影响 run 记录（`note_id` 成为悬空引用，前端跳转时容错）

### 5.4 未登记的 4 张表（v1 补登，2026-10-28）

> 以下 DDL 与 `SchemaMigrator.BRIEFING_DDL` 逐字一致（`CREATE TABLE IF NOT EXISTS`，追加式迁移，不改动既有表）。
> 全部**按 `space_id` 隔离**，且都不存正文 —— 正文永远是 `notes` 表里的一篇普通笔记。

#### 5.4.1 `archive_runs` —— 归档运行记录

对应 `POST /api/archive/run`。归档**只搬家不删数据**：把超期的周报/简报笔记移入归档目录。

```sql
CREATE TABLE IF NOT EXISTS archive_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id      INTEGER NOT NULL,
  started_at    TEXT    NOT NULL,
  finished_at   TEXT,
  status        TEXT    NOT NULL,              -- running / success / failed / disabled
  moved_folders INTEGER NOT NULL DEFAULT 0,
  moved_notes   INTEGER NOT NULL DEFAULT 0,
  skipped       INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_archive_runs_space ON archive_runs(space_id, started_at DESC);
```

#### 5.4.2 `repo_star_snapshots` —— 仓库 star 快照（周报算「一周涨了多少」用）

```sql
CREATE TABLE IF NOT EXISTS repo_star_snapshots (
  space_id    INTEGER NOT NULL,
  source      TEXT    NOT NULL,               -- github / gitee
  repo        TEXT    NOT NULL,
  stars       INTEGER NOT NULL,
  captured_at TEXT    NOT NULL,
  PRIMARY KEY (space_id, source, repo, captured_at)
);
CREATE INDEX IF NOT EXISTS idx_repo_stars_lookup
  ON repo_star_snapshots(space_id, source, repo, captured_at DESC);
```

复合主键 `(space_id, source, repo, captured_at)` 保证同一仓库同一时刻只有一条快照；回溯窗口由 `kb.weekly.snapshot-lookback-days`（默认 7）决定。

#### 5.4.3 `weekly_runs` —— 开源周报运行记录

对应 `POST /api/weekly/run`。

```sql
CREATE TABLE IF NOT EXISTS weekly_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id      INTEGER NOT NULL,
  iso_week      TEXT    NOT NULL,             -- 形如 2026-W44
  started_at    TEXT    NOT NULL,
  finished_at   TEXT,
  status        TEXT    NOT NULL,             -- running / success / partial / failed
  notes_created INTEGER NOT NULL DEFAULT 0,
  github_count  INTEGER NOT NULL DEFAULT 0,
  gitee_count   INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_weekly_runs_week ON weekly_runs(space_id, iso_week);
```

同一空间同一 ISO 周成功跑过就不再自动跑（`runIfDue` 判断依据）。

#### 5.4.4 `briefing_cache` —— 简报条目翻译与配图缓存

键是 `(space_id, url)`。缓存翻译结果（`title_zh` / `summary_zh`）与已下载配图（`attachment_id` 指向 `attachments.id`），避免同一 URL 反复翻译与重复下载。

```sql
CREATE TABLE IF NOT EXISTS briefing_cache (
  space_id      INTEGER NOT NULL,
  url           TEXT    NOT NULL,
  title_zh      TEXT,
  summary_zh    TEXT,
  image_remote  TEXT,                         -- 原始远程图片地址
  attachment_id INTEGER,                      -- 落到本地后的附件 id
  created_at    TEXT    NOT NULL,
  PRIMARY KEY (space_id, url)
);
```

> ⚠️ `briefing_cache` 的 `attachment_id` **不是外键**（没有 `REFERENCES`），删附件不会级联清理缓存行；读缓存时要容忍 `attachment_id` 指向已删附件，回落为无图。

### 5.5 迁移后的表清单（实测，2026-10-28）

| 来源 | 张数 | 表 |
|---|---|---|
| `backend/src/main/resources/db/schema.sql` | 12 表 + 1 虚表 | users, invites, spaces, folders, notes, note_versions, tags, note_tags, links, attachments, activities, settings + notes_fts（FTS5 虚表） |
| `SchemaMigrator.BRIEFING_DDL` | 6 | briefing_runs, briefing_seen, archive_runs, repo_star_snapshots, weekly_runs, briefing_cache |
| **合计 DDL 语句** | **32** | 26 条（12 表 + 1 虚表 + 3 触发器 + 10 索引）+ 6 张追加表 |

> 早期文档（`VERIFY.md:1053`）写「29 条（原 26 + 简报表 3）」已过时：追加表从 3 增到 6。
---

## 6. 优化轮新增的表（2026-10-27，全部为追加式 DDL，不改既有表）

### 6.1 `briefing_cache` —— 简报富化缓存

| 列 | 说明 |
|---|---|
| `space_id` / `url` | 复合主键，按源的原文链接缓存 |
| 译文 / 摘要 / 配图地址 | 命中即跳过翻译与文章页抓取 |

**失败不写缓存** —— 额度恢复后能自动补齐。

### 6.2 `weekly_runs` —— 开源周报运行记录

| 列 | 说明 |
|---|---|
| `iso_week` | 如 `2026-W43`；同一 ISO 周只自动跑一次 |
| `status` | running / success / failed |
| `notes_created` / `notes_skipped` | 按「周目录 + 标题」判重 |

> 主键用 `GeneratedKeyHolder` 取，**不要用 `SELECT last_insert_rowid()`** —— 连接池下会拿到别的连接的 id，
> 导致 `finish()` 更新不到自己那行、run 永远卡在 running、每次重启都重跑一遍。

### 6.3 `repo_star_snapshots` —— 仓库 star 快照

| 列 | 说明 |
|---|---|
| `space_id` / `source`(github\|gitee) / `repo` / `captured_at` | 复合主键 |
| `stars` | 当时的总星数 |

用途：GitHub 有官方「本周新增 star」，Gitee 没有 —— 所以 Gitee 的周增靠
「本次快照 − 7 天前最接近的一次快照」算出来；找不到 7 天前的快照就显示「—（首次收录，下周起显示）」，**不编数字**。

### 6.4 `archive_runs` —— 归档运行记录

| 列 | 说明 |
|---|---|
| `status` | success / failed |
| `moved_folders` / `moved_notes` / `skipped` | 本次搬了多少、跳过多少 |

归档**只搬家不删数据**，并在事务内做「搬前 N 篇 / 搬后 N 篇」数量校验，不一致则回滚。

### 6.5 优化轮之后的表清单

~~~
users spaces notes folders tags note_tags note_versions links attachments activities settings
invites notes_fts notes_fts_data notes_fts_idx notes_fts_docsize notes_fts_config
briefing_runs briefing_seen briefing_cache
weekly_runs repo_star_snapshots archive_runs
~~~

共 **24 张表**。

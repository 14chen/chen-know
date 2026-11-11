# API.md — REST 接口契约（冻结版 v1）

> 本文件是**唯一真源**。前后端并行开发均以此为据。任何一方需要变更接口，必须回报 Lead 修订本文件后再动代码。

## 0. 全局约定

- **Base URL**：`/api`，全部返回 `application/json; charset=UTF-8`（附件流除外）
- **认证**：Session Cookie `KB_SESSION`，属性 `HttpOnly; SameSite=Lax; Path=/`；走 HTTPS 时附加 `Secure`
- **端口**：`8080`（80/443 已被 Steam++ 占用，避开）
- **坐标系**：所有时间字段为 ISO-8601 UTC 字符串

### 0.1 成功响应
直接返回资源 JSON，HTTP 200（创建返回 201，删除返回 204）。

### 0.2 错误响应
```json
{ "error": { "code": "NOT_FOUND", "message": "笔记不存在", "field": "id" } }
```

| code | HTTP | 含义 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | 参数校验失败，`field` 指明字段 |
| `UNAUTHORIZED` | 401 | 未登录或会话过期 |
| `FORBIDDEN` | 403 | 已登录但无权访问该资源（含跨空间越权） |
| `NOT_FOUND` | 404 | 资源不存在或已属他人 |
| `CONFLICT` | 409 | 唯一约束冲突（用户名已存在、标签重名等） |
| `METHOD_NOT_ALLOWED` | 405 | 路径存在但方法不支持（v1 修订补入，原表遗漏） |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体/附件超限 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | 附件类型不在白名单 |
| `TOO_MANY_REQUESTS` | 429 | 登录失败次数过多被限流 |
| `INTERNAL` | 500 | 服务端异常（**不得**把堆栈返回给客户端） |

> **v1 补充说明**（实现中发现、契约原文未覆盖，按实现为准并记录于此）：
> - **登录时账号被停用 → 403**（不是 401）。仅在密码正确时才会暴露此信息，对用户更友好且不泄露账号是否存在。
> - **`GET /api/health` 降级语义**：数据库探测失败时返回 **HTTP 200 + `{"status":"degraded","db":"error"}`**（保持 200 便于探活，用 body 区分状态）。
> - **CSRF 未启用**：本项目未定义 CSRF token。防线是 `SameSite=Lax` + 所有**状态变更**操作只用 POST/PATCH/DELETE。
>   （v1 修订：`GET /api/export/*` 会在响应时写一条 `export` 审计日志，因此严格说存在 GET 写库。
>   这不构成数据完整性风险 —— 跨站最多触发一次日志写入与一次导出计算，不改动任何用户数据。）
> - **登录限流状态在内存**，重启清零。单实例部署下可接受。

### 0.3 分页
请求 `?page=1&size=50`（page 从 1 起，size 上限 200，默认 50）。
```json
{ "items": [], "page": 1, "size": 50, "total": 123 }
```
> 所有**列表类**端点统一用此信封，包括 `/api/notes`、`/api/search`、`/api/admin/users`、`/api/admin/invites`、`/api/trash` 内的数组。
> 例外：`/api/notes/{id}/versions`、`/api/notes/{id}/backlinks`、`/api/notes/{id}/links`、`/api/tags`、`/api/recent`、`/api/favorites` 返回裸数组或对象（数量天然有界）。

---

## 1. 认证 `/api/auth`

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/register` | 注册。**库里无任何用户时**首人免邀请码并成为 `admin`；否则必须带有效 `inviteCode` |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/logout` | 登出，204 |
| `GET` | `/api/auth/me` | 当前用户；未登录返回 401 |

`POST /api/auth/register`
```json
// req
{ "username": "alice", "displayName": "爱丽丝", "password": "********", "inviteCode": "a1b2..." }
// 201
{ "id": 1, "username": "alice", "displayName": "爱丽丝", "role": "admin" }
```
校验：`username` 3–32 位 `[A-Za-z0-9_-]` 且唯一；`password` ≥ 8 位；`displayName` 1–32 字。

> ⚠️ **注册成功不下发会话（v1 修订：原文未写明，联调时产生歧义）**
> `POST /api/auth/register` 返回 201 时**不设置 `KB_SESSION` Cookie**，它只创建账号。
> 客户端在注册成功后**必须再调一次 `POST /api/auth/login`** 才能进入已登录状态。
> 若自动登录失败，前端应提示「注册成功，请手动登录」而不是把人踢回空表单。
> （这样设计的好处：注册路径与登录路径共用同一套认证逻辑，少一处可能被绕过的会话建立点。）

`POST /api/auth/login`
```json
// req
{ "username": "alice", "password": "********" }
// 200 —— 同时下发 Set-Cookie: KB_SESSION=...
{ "id": 1, "username": "alice", "displayName": "爱丽丝", "role": "admin" }
```

**安全要求**：同一用户名连续失败 5 次 → 锁定 15 分钟并返回 429；登录接口的响应时间不得因用户是否存在而明显不同（防用户名枚举）。

---

## 2. 管理员 `/api/admin` （仅 `role=admin`，否则 403）

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/admin/users` | 用户列表 |
| `POST` | `/api/admin/users` | 直接创建账号 `{username, displayName, password, role}` |
| `PATCH` | `/api/admin/users/{id}` | 改 `{displayName?, password?, role?, disabled?}`；**不得**停用/降级自己，不得停用最后一个 admin |
| `DELETE` | `/api/admin/users/{id}` | 删除用户，级联删除其空间与全部数据；不得删除自己 |
| `GET` | `/api/admin/invites` | 邀请码列表（含 `used`、`expired` 计算字段） |
| `POST` | `/api/admin/invites` | 生成邀请码 `{expiresInHours?: number}` → `{code, expiresAt}` |
| `DELETE` | `/api/admin/invites/{code}` | 吊销未使用的邀请码 |

---

## 3. 目录 `/api/folders`

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/folders?tree=true` | 当前空间目录树（默认 `tree=true` 返回嵌套结构；`tree=false` 返回扁平列表） |
| `POST` | `/api/folders` | `{parentId: number\|null, name: string}` → 201 |
| `PATCH` | `/api/folders/{id}` | `{name?, parentId?, sortOrder?}` —— **禁止把文件夹移进自己的子孙**，否则 400 |
| `DELETE` | `/api/folders/{id}` | 软删该文件夹 + 全部子孙 + 其中笔记（见 SCHEMA §3），204 |

树节点结构：
```json
{ "id": 3, "parentId": null, "name": "技术", "sortOrder": 0,
  "noteCount": 5, "children": [ /* 同构 */ ] }
```
> **`noteCount` 语义（v1 修订，契约原文有歧义，现固化）**：= 该目录**直属**的未删除笔记数，**不含子孙目录**里的笔记。
> 理由：树可展开/折叠，展开后各层计数自洽；若含子孙则同一篇笔记会在多层被重复计数，反而误导。

### 3.1 `folderId` 参数语义（v1 修订，原文未定义）

出现在 `GET /api/notes`、`GET /api/search`、`GET /api/favorites` 上：

| 取值 | 语义 |
|---|---|
| 不传 / 空 | **不按目录过滤**（全部笔记） |
| `folderId=<正整数>` | 该目录的**直属**笔记（与 `noteCount` 口径一致） |
| `folderId=0` | **未分类**（`folder_id IS NULL`） |

> `0` 不是合法目录 id（自增主键从 1 起），因此可安全用作「未分类」哨兵值。前端左栏的「未分类」入口即用 `folderId=0`。

---

## 4. 笔记 `/api/notes`

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/notes` | 列表（**不含正文**）。参数：`folderId`、`tag`、`q`、`favorite`、`page`、`size`、`sort`(`updated`\|`created`\|`title`) |
| `GET` | `/api/notes/{id}` | 详情，含 `content`、`tags`、`backlinkCount` |
| `POST` | `/api/notes` | `{folderId?, title?, content?}` → 201 |
| `PATCH` | `/api/notes/{id}` | `{folderId?, title?, content?, isFavorite?, isPinned?, sortOrder?}` |
| `DELETE` | `/api/notes/{id}` | 软删，204 |
| `POST` | `/api/notes/{id}/view` | 记一次浏览（写 `activities`），204 |
| `GET` | `/api/notes/{id}/links` | 出链：`{resolved: [...], dangling: [...]}`，元素结构见 §4.1 |
| `GET` | `/api/notes/{id}/backlinks` | 反链：引用本笔记的其它笔记 |
| `GET` | `/api/notes/{id}/versions` | 版本列表（倒序，含 `version`/`createdAt`/`size`） |
| `GET` | `/api/notes/{id}/versions/{version}` | 某版本全文 |
| `POST` | `/api/notes/{id}/versions/{version}/restore` | 回滚到该版本（**回滚本身也产生一个新版本**，不丢当前内容） |

列表项结构：
```json
{ "id": 12, "folderId": 3, "title": "Spring Boot 笔记", "excerpt": "自动配置原理……",
  "isFavorite": false, "isPinned": false, "version": 7,
  "tags": [{"id":2,"name":"Java","color":"#2563eb"}],
  "createdAt": "2026-10-16T02:00:00Z", "updatedAt": "2026-10-16T02:33:14Z" }
```

**PATCH 语义**：仅 `content` 或 `title` 变化时才产生历史版本（收藏/置顶/移动目录不产生版本）。保存时同步重算 `excerpt`、`search_blob`，并重解析 `[[链接]]` 重建该笔记的 `links` 行。

`GET /api/notes/{id}/backlinks` 返回：
```json
{ "items": [ { "noteId": 5, "title": "索引表", "excerpt": "……见 [[Spring Boot 笔记]]……" } ] }
```

#### 4.1 链接结构（v1 修订：原文只写 `resolved: [...]` 未定元素结构，现固化）

`GET /api/notes/{id}/links` →
```json
{
  "resolved": [ { "noteId": 5, "title": "索引表", "folderId": 3 } ],
  "dangling": [ "还不存在的笔记" ]
}
```
- `resolved[].noteId` —— 被引用笔记的 id（必填，点击可跳转）
- `resolved[].title` / `folderId` —— 供展示与面包屑
- `dangling` —— **纯字符串数组**（尚未创建的目标标题）
- 已被软删除的目标笔记**不得**出现在 `resolved` 里，应退化为 `dangling`

#### 4.2 `/api/recent` 结构（v1 修订：原文未固定时间字段名）

`GET /api/recent?limit=20` →
```json
{ "items": [ { "noteId": 12, "title": "Spring Boot 笔记", "folderId": 3,
               "excerpt": "自动配置原理……", "viewedAt": "2026-10-16T02:33:14Z" } ] }
```
- **时间字段名固定为 `viewedAt`**（不是 `visitedAt` / `lastViewedAt` / `updatedAt`）
- 同一笔记多次浏览只出现一次，取**最近一次**时间
- 只含未删除笔记，按 `viewedAt` 倒序

#### 4.3 `/api/tags` 与 `/api/favorites` 结构

`GET /api/tags` → **裸数组**（非分页信封）：
```json
[ { "id": 2, "name": "Java", "color": "#2563eb", "count": 7 } ]
```
- `count` = 该标签下**未删除**笔记数；`count` 为 0 的标签仍然返回（前端自行决定是否隐藏）

`GET /api/favorites` → 分页信封，`items` 元素为 **§4 的笔记列表项结构**（与 `GET /api/notes` 完全一致）。

### 4.4 实现澄清（v1 修订：原文未定义，按联调实测结果固化）

| 项 | 约定 |
|---|---|
| **置顶排序** | `GET /api/notes` 的结果中 `isPinned=1` 的笔记**始终排在前面**：先 `is_pinned DESC`，再按 `sort` 指定的字段。否则前端的「置顶」操作没有可见效果 |
| **空 PATCH** | `PATCH /api/notes/{id}` 与 `/api/folders/{id}` 传 `{}`（无任何字段）→ **400 `VALIDATION_FAILED`，`field="body"`**。用于尽早暴露前端字段名拼写错误，不做静默空操作 |
| **版本回滚的活动日志** | 写 `action='edit'`（它确实改了正文）。`action='restore'` **专指回收站恢复**，两者不混用 |
| **`versions[].size`** | **字符数**（码点数），不是字节数 |
| **`GET /versions/{v}` 的 `v`** | 传当前版本号返回当前内容（回落到 `notes`）；对当前版本执行回滚是 no-op 200 |
| **`PUT /api/notes/{id}/tags` 的响应** | 返回**更新后的笔记详情**（客户端读 `.tags`），不是裸数组 |
| **反链规则** | 自引用不计入自己；同一来源笔记的多条不同标题引用，按来源笔记去重 |
| **软删与 `updated_at`** | 软删**只写 `deleted_at`，不改 `updated_at`**，保证恢复后排序不乱 |
| **正文字数上限** | `content` ≤ 2 MB、`title` ≤ 512 字符；超出 400 `VALIDATION_FAILED` |
| **请求体上限** | **非 multipart 请求体 ≤ 8 MB**，超出 413 `PAYLOAD_TOO_LARGE`（公网暴露下的基本 DoS 防护；multipart 上传另有 20 MB 上限） |

---

## 5. 搜索 `/api/search`

`GET /api/search?q=天气&tag=生活&folderId=&page=&size=`

```json
{ "items": [ { "noteId": 12, "title": "今天<em>天气</em>很好",
               "highlight": "……适合出去散步<em>天气</em>……", "score": -1.23,
               "folderId": 3, "updatedAt": "..." } ],
  "page": 1, "size": 50, "total": 4 }
```
- `q` 为空时退化为「按 `tag`/`folderId` 过滤的列表」
- `highlight` 用 `<em>` 标记，**在原文上计算**（不得用 FTS5 `snippet()`，理由见 SCHEMA §2）
- 匹配逻辑见 SCHEMA §2 的 `SearchText.normalize` / `toMatchExpression`

---

## 6. 标签 `/api/tags`

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/tags` | 当前空间标签，含 `count`（该标签下未删除笔记数） |
| `POST` | `/api/tags` | `{name, color?}` → 201；重名 409 |
| `PATCH` | `/api/tags/{id}` | `{name?, color?}` |
| `DELETE` | `/api/tags/{id}` | 删标签并解除全部关联，204 |
| `PUT` | `/api/notes/{id}/tags` | 覆盖式设置 `{tagNames: ["Java","笔记"]}`，不存在的标签自动创建 |

---

## 7. 附件 `/api/attachments`

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/attachments` | `multipart/form-data`：`file`（必填）、`noteId`（可选）→ 201 |
| `GET` | `/api/attachments/{id}` | 返回文件流，带 `Content-Disposition: inline; filename*=UTF-8''...` |
| `DELETE` | `/api/attachments/{id}` | 删记录并删除磁盘文件，204 |

```json
// POST 201
{ "id": 7, "url": "/api/attachments/7", "originalName": "架构图.png",
  "mimeType": "image/png", "sizeBytes": 20480 }
```

**安全要求**（公网暴露，必须全部满足）：
1. 白名单：`image/png|jpeg|gif|webp|svg+xml`、`application/pdf`、`text/plain|markdown`、`application/zip`
2. 单文件上限 20 MB（超出 413）
3. 磁盘文件名由服务端生成（`{spaceId}/{UUID}{从 MIME 推导的扩展名}`），**绝不使用客户端文件名做路径**
4. 落盘路径必须做 `normalize()` 后校验仍在 `data/uploads` 内（防路径穿越）
5. `GET` 时按记录的 `mimeType` 设置响应头，并附 `X-Content-Type-Options: nosniff`；`svg` 强制 `Content-Disposition: attachment`（防 SVG 内嵌脚本 XSS）
6. 只能读取属于自己空间的附件

---

## 8. 回收站 `/api/trash`

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/trash` | `{notes:[...], folders:[...]}`（倒序按 `deletedAt`），元素结构见 §8.1 |
| `POST` | `/api/trash/notes/{id}/restore` | 恢复笔记，204 |
| `POST` | `/api/trash/folders/{id}/restore` | 恢复文件夹及其子孙与随删笔记，204 |
| `DELETE` | `/api/trash/notes/{id}` | 彻底删除，204 |
| `DELETE` | `/api/trash/folders/{id}` | 彻底删除，204 |
| `POST` | `/api/trash/empty` | 清空回收站，返回 `{deletedNotes: n, deletedFolders: m}` |

### 8.1 回收站元素结构（v1 修订：原文只写 `[...]`，未定字段名）

```json
{
  "notes":   [ { "id": 12, "title": "Spring Boot 笔记", "folderId": 3,
                 "folderName": "技术", "deletedAt": "2026-10-16T02:33:14Z" } ],
  "folders": [ { "id": 3, "name": "技术", "parentId": null,
                 "deletedAt": "2026-10-16T02:33:14Z", "noteCount": 5 } ]
}
```
- `notes[].folderName` —— 原目录名（可能为 `null`，前端显示「未分类」）
- **`folders[].noteCount` —— 恢复该目录时会**一并恢复**的笔记数（含子孙目录）**。
  注意它与 §3 目录树里的 `noteCount`（仅直属）**口径不同**：这里回答的是「恢复它会带回多少东西」，所以必须含子孙。
- 两个数组都按 `deletedAt` 倒序

---

## 9. 统计与动态 `/api`

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/stats` | 见下 |
| `GET` | `/api/recent?limit=20` | 最近浏览的笔记 |
| `GET` | `/api/favorites` | 收藏列表（复用笔记列表项结构） |

```json
// GET /api/stats
{ "noteCount": 42, "folderCount": 8, "tagCount": 12, "attachmentCount": 3,
  "totalAttachmentBytes": 1048576, "trashCount": 2,
  "updatedToday": 3,
  "dailyCreated": [ {"date":"2026-10-10","count":2}, {"date":"2026-10-11","count":0} ] }
```
`dailyCreated` 固定返回最近 14 天（含今天），无数据的日期补 0。

---

## 10. 导入导出 `/api`

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/export/notes/{id}.zip` | **导出单篇为 ZIP（界面用这个）**：`{标题}.md` + `attachments/{id}-{原名}`（**只含该篇正文实际引用到的附件**）+ `manifest.json` |
| `GET` | `/api/export/notes/{id}.md` | **仅正文，不含附件**（保留兼容；图片引用是相对路径，图片需自备）。界面不再使用 |
| `GET` | `/api/export/all` | 导出全部为 ZIP：`notes/{目录路径}/{标题}.md` + `attachments/` + `manifest.json` |
| `POST` | `/api/import/markdown` | `multipart`：多个 `.md` / 图片 / 一个 `.zip` |
| `POST` | `/api/import/preview` | 同上但只解析不入库，返回将要创建的条目供确认 |

### 10.0 完整性约定（v1 修订：单篇导出改为 ZIP）

**问题**：单个 `.md` 无法携带图片 —— 导出拿走后图片必然读不到。

**方案**：单篇导出改为 ZIP，结构与整库导出一致（只是范围缩到一篇）：

```
{标题}.md                     正文；图片引用已重写为 attachments/{id}-{原名}（相对包根，无 ../）
attachments/{id}-{原名}      只打包该篇正文里实际引用到的附件
manifest.json                与整库导出一致
```

- md 在**包根**，所以引用前缀是 `attachments/`（不需要 `../../`）
- **不打包未被引用的附件**（该篇上传过但正文里已删除引用的文件）
- 重新导入这个 ZIP 能得到完整的一篇：正文、图片、标签、目录（front matter 里带 `tags` / `folder`）

**导出 → 导入的完整性**（必须由测试锁定，见 `docs/VERIFY.md`）：
正文、图片（字节一致）、标签、所在目录、双向链接 `[[…]]`、front matter 元数据 —— 六项在往返后必须完全一致。


```json
// POST /api/import/markdown 200
{ "imported": 12, "skipped": 1, "errors": ["bad.md: 编码无法识别"],
  "imagesImported": 5, "missingImages": [] }
```

### 10.1 `POST /api/import/preview` 响应结构（v1 修订：原文未定义，现固化）

**与 `/api/import/markdown` 共用同一套解析逻辑**，区别只是不入库。

```json
{
  "items": [
    { "title": "Spring Boot 笔记", "sourceFile": "spring.md",
      "tags": ["Java", "笔记"], "folder": "技术", "sizeBytes": 1234 }
  ],
  "total": 12,
  "errors": ["bad.md: 编码无法识别"],
  "imagesImported": 5,
  "missingImages": [
    { "sourceFile": "notes/使用手册.md", "title": "使用手册", "line": 12,
      "target": "images/02-登录页.png", "reason": "文件集合里没有这个路径" }
  ]
}
```
- `items[]` 的字段名**固定**为上表：`title` / `sourceFile` / `tags` / `folder` / `sizeBytes`
  - `title` —— 已按 front matter → 文件名 → 首个 `# 标题` 的优先级解析出的**最终标题**
  - `sourceFile` —— 来源文件名（ZIP 内为相对路径）。**不要叫 `source` / `file` / `filename` / `path`**
  - `folder` —— 目标目录名，无则 `null`
  - `tags` —— 字符串数组，无则 `[]`
- `total` = 将要导入的条目数
- `errors[]` = 预览阶段就已失败的文件（**不阻断其余条目**）
- `total` 为 0 且 `errors` 非空时，前端应展示错误而不显示空列表

### 10.2 图片随笔记一起导入（v1 修订：新增）

**背景**：原实现把 ZIP 内非 `.md` 条目一律算 `skipped` 丢弃，正文里的 `![](images/a.png)` 也不重写 —— 导入后的笔记图片必然 404。这是缺陷，不是特性。

**传输约定**：multipart 每个文件部分的 `filename` **可以携带相对路径**（含 `/`，形如 `docs/images/a.png`）。
- 含 `/` → 按相对路径处理
- 不含 `/` → 只有文件名（等同放在虚拟根目录）
- 文件夹选择时前端传 `file.webkitRelativePath`，天然就是这个形式；**无需新增字段**

**解析与重写**：对每个 `.md`，扫描 `![](target)`、`![alt](<target>)`、`<img src="target">`：
1. 跳过 `http://` `https://` `//` `data:` 以及 `/api/attachments/` 开头（原样保留，不算缺失）
2. `target` URL-decode、去 `?query#fragment`、按 `dirname(mdPath)` 解析 `./` `../`
3. 在「文件集合索引」里按序匹配：**精确路径 → 大小写不敏感 → basename 唯一匹配**（多个同名视为未命中，避免配错图）
4. **命中** → 作为附件上传（复用 `AttachmentService` 的 20 MB 上限与 MIME 白名单）→ 引用重写为 `/api/attachments/{新id}`
5. **未命中** → 正文**原样保留**，记入 `missingImages[]`

**处理顺序**：插入笔记（原文）→ 带 `noteId` 上传图片 → PATCH 正文为重写后内容。无图片引用的笔记不做多余 PATCH。

`missingImages[].reason` 取值：`文件集合里没有这个路径` / `路径非法` / `不支持的图片类型` / `暂不支持引用式写法` / `超过单文件上限`。

`preview` 语义不变：**只解析、不入库、不上传**；它报告的 `missingImages` 是「如果现在导入，这些会缺」。

**导出侧对齐**：`ExportService` 必须把正文里的 `/api/attachments/{id}` 重写为**相对于该 `.md` 所在目录**的路径：

| 笔记在包内位置 | 引用写成 |
|---|---|
| `notes/技术/前端/x.md` | `../../../attachments/15-图.png` |
| `notes/x.md` | `../attachments/15-图.png` |
| 单篇导出（虚拟根） | `attachments/15-图.png` |

> ⚠️ 判据是「**解析后**指向 ZIP 内那个条目」，**不是**「文本与条目名相同」。
> Markdown 渲染器按 `.md` 所在目录解析相对链接；写成 `attachments/…` 会让 `notes/技术/x.md` 去找 `notes/技术/attachments/…` 而找不到。
> `{originalName}` 与 ZIP 条目名**逐字相同**（含空格时用 `![](<…>)` 包裹，不做百分号编码 —— 磁盘文件名就带空格，编辑器按字面找）。
> 往返自证：按 §10.2 的「相对 `dirname(mdPath)` 解析」规则重新导入，必须能正确解回该条目。
> 引用指向的附件不存在时保留原文、不报错。

**`preview` 的 `imagesImported` 语义**：表示「**将会被导入**的图片数量」（预览实际不上传，这是预期值，不是 0）——前端据此提示用户「将导入 N 张图」。

### 10.3 导入规则
- 标题优先级（v1 修订：原文写了「文件名 → `# 一级标题`」，但文件名几乎总是存在，H1 实际轮不到，此处按实现如实描述）：
  1. YAML front matter 的 `title`
  2. **文件名（去扩展名）**
  3. 仅当上述得到空标题时，才回退到正文第一个 `# 一级标题`
- `tags` / `folder` 只从 front matter 取，无则 `[]` / `null`
- `skipped` 与 `errors` 的口径（v1 修订：`skipped` 原文包含「ZIP 内的非 .md 条目」，**已废止** —— 那条规则会把图片静默丢弃，是缺陷；现改为只统计空文件与非图片的无关条目）：
  - `skipped` = **主动跳过但不算错**的条目：空文件、既不是 `.md` 也不是图片的无关条目
  - `errors[]` = **失败**条目：编码非 UTF-8、路径穿越被拒、超大小上限、不支持的类型
  - 图片类条目**不再计入 `skipped`**：被引用并成功导入的进 `imagesImported`，未被任何笔记引用或找不到的进 `missingImages`
- Markdown 里的 `[[标题]]` 链接在导入后由笔记模块的链接重建逻辑处理
- 解压 ZIP 时必须防 **Zip Slip**：逐条目 `normalize()` 后校验仍在目标目录内，拒绝绝对路径与 `..`
- ZIP 条目数上限 2000，解压后总大小上限 200 MB（**超限时的拒绝语义与响应体见 §10.3.1**）
- **容器上传上限（v1 修订）**：`spring.servlet.multipart.max-file-size=256MB`、`max-request-size=320MB`
  - 原先是 20MB / 64MB，与「解压后 200 MB」的承诺矛盾 —— **任何超过 20 MB 的导出 ZIP 根本导不回来**，属既有缺陷
  - 抬限后仍有多层防护：单张图片 20 MB 由 `AttachmentService` 逐张判定（超限**跳过该张并记 `missingImages`**，不让整批失败）、ZIP 内部 2000 条目 / 200 MB 上限不变、非 multipart 的 JSON 仍受 `RequestBodySizeLimitFilter` 的 8 MB 限制

### 10.3.1 超量 ZIP 的拒绝语义（v1 修订，2026-10-28）

**校验发生在任何写入之前** —— 超限时整批拒绝，**库内 0 新增**，不会出现「导了一半」的中间态。

| 触发条件 | HTTP | 响应 message（系统原话） |
|---|---|---|
| ZIP 条目数 > 2000 | **413** | `<zip名>: ZIP 条目数超过上限 2000，已拒绝整个压缩包（未写入任何笔记）` |
| 解压后总大小 > 200 MB | **413** | `<zip名>: 解压后总大小超过 200 MB 上限，已拒绝整个压缩包（未写入任何笔记）` |
| 多选 / 文件夹方式，文件数 > 2000 | **413** | `文件数超过上限 2000，已拒绝整批` |
| 多选 / 文件夹方式，总大小 > 200 MB | **413** | `总大小超过 200 MB 上限，已拒绝整批` |

响应体是标准错误信封：

~~~json
{ "error": { "code": "PAYLOAD_TOO_LARGE",
             "message": "backup.zip: ZIP 条目数超过上限 2000，已拒绝整个压缩包（未写入任何笔记）" } }
~~~

- `POST /api/import/markdown` 与 `POST /api/import/preview` **共用同一套 parse 校验**，两者在此情形都返回 **413**；
  **preview 不再「假成功」**（以前超量包在预览阶段可能返回正常结构，让人误以为能导）
- 条目数按 ZIP 内**全部条目**计（含目录项与图片），不是只数 `.md`
- 这是 DoS 防线，**不因业务诉求放宽**；确有更大规模的需求走 §10.4

### 10.3.2 空文件

`.md` 内容 trim 后为空（纯空格 / 纯空行）→ 计入 `skipped`，**不落库、不生成空笔记**。
既不进 `errors[]`（不是错误），也不进 `imported`（没有内容可导）。

### 10.4 导出 / 导入的上限不对称（已知限制，2026-10-28）

`GET /api/export/all` 是**每篇笔记一个 ZIP 条目**（`notes/{目录}/{标题}.md`），附件另计。
于是存在一个不对称：

> **笔记数 > 2000 的用户，其整库导出包无法再导回本系统** —— 导入端会按 §10.3.1 以 413 拒绝整包。

**这是已知限制，本轮不放宽上限。** 理由：2000 条目 / 200 MB 是防 DoS 的硬防线；只为「能导回自家的大包」而抬限，等于把这道防线拆掉。

两条替代路径：

1. **分片导出**：界面只提供「导出全部（ZIP）」与「单篇导出（ZIP）」两种（见使用手册 §十），没有「按目录导出」。需要分批时，对要归档的笔记逐篇用「单篇导出」，或直接调下面的接口按 id 拉。
2. **超大库直接用 API 导出**：
   - `GET /api/export/notes/{id}.zip` —— 每次只处理**一篇**（正文 + 该篇引用的图片），天然不受条目上限约束
   - `GET /api/export/notes/{id}.md` —— 只要正文（图片需自备）

> 反过来也成立：从别处导入一个 > 2000 篇的库同样会被 413 拒绝，建议拆包分批导入。
> 分批导入的边界：**单批**（一次请求）的条目数与解压总大小受 §10.3.1 约束，多批之间互不影响。

---

## 11. 健康检查（无需登录）

`GET /api/health` →
```json
{ "status": "ok", "version": "1.0.0", "time": "2026-10-16T02:33:14Z", "db": "ok" }
```

---

## 12. 前端静态资源（v1 修订：已从零构建改为 React 构建产物）

| 路径 | 内容 |
|---|---|
| `/` | **整个单页应用**（未登录显示登录页、已登录显示主界面，前端自行判断） |
| `/assets/index-*.js` `/assets/*.css` | Vite 构建产物（带内容哈希） |
| `/api/**` | 后端接口 |

- 前端是 **React 19 + TypeScript + Vite** 构建的单页应用，**hash 路由**（`#/notes/12`、`#/search?q=…`）
- 构建产物落在 `backend/src/main/resources/static/`，由 Spring Boot 直接提供
- **因为是 hash 路由，后端不需要做 SPA fallback**：`/` 由 `WelcomePageHandlerMapping` 映射到 `static/index.html`，hash 部分不会发给服务器，子路由刷新不会 404
- 日常使用**不需要装 Node** —— 产物已随仓库提供；只有改前端源码时才需要 `npm run build` **并重新 `package`**（jar 里是打包时刻的静态资源）
- 旧的零构建前端已归档到 `frontend-legacy/`，不参与构建
---

# 十一、每日 AI 简报（第六轮新增）

完整抓取契约见 **`docs/BRIEFING.md`**。这里只登记 HTTP 接口与配置。

## §11.1 立即生成

```
POST /api/briefing/run
```

- 需登录。**不接受 `spaceId` 参数** —— 永远写进调用者自己所在空间，杜绝越权写。
- 同步执行（内部并发抓各源），正常 10–20s。

返回 `200`：

```json
{ "runId": 3, "status": "success", "totalItems": 41, "newItems": 41, "noteId": 12,
  "sourceReport": [ {"source":"openai","ok":true,"count":5,"error":null}, ... ] }
```

| 状态码 | 含义 |
|---|---|
| `200` | 已执行完毕（`status` 可能是 `success` 或 `partial`） |
| `403` | **功能已关闭**：`kb.briefing.enabled=false` 时直接拒绝，**不发起任何外网请求** |
| `409` | 该空间已有一个 run 正在执行 |
| `401` | 未登录 |

> `status=partial` 表示「部分源取不到，但简报已生成」。被 `kb.briefing.skip-sources` 跳过的源（默认 `importai`，Cloudflare 反爬）**不计入 partial 判定**。

> **v1 修订（2026-10-28）· 关闭开关时必须硬拦**
> 此前 `kb.briefing.enabled=false` 只挡定时任务与启动补抓，手动 `POST /run` 仍会**真实外连**（缺陷 DEF-E5-009，实测一次运行产生 31 次外部抓取）。
> 现已在 service 层加闸：进入并发锁与任何抓取**之前**即抛 `403 FORBIDDEN`，响应体为
> ```json
> { "error": { "code": "FORBIDDEN", "message": "简报功能已关闭（kb.briefing.enabled=false），已拒绝执行，未发起任何外网请求" } }
> ```
> **只读端点不受影响**：`GET /api/briefing/sources`、`GET /api/briefing/runs` 在关闭状态下照常可用。`/api/weekly/run` 同规则（`kb.weekly.enabled=false` → 403）。

## §11.2 运行历史

```
GET /api/briefing/runs?limit=10
```

返回 `{ "items": [ { id, startedAt, finishedAt, status, totalItems, newItems, noteId, sourceReport } ] }`，按 `started_at` 倒序。`limit` 默认 10，上限 **100**（代码 `Math.min(limit, 100)`；早期文档写的 50 与实现不符，已按实现修正）。

## §11.3 源清单

```
GET /api/briefing/sources
```

返回 `{ "items": [ { id, name, url, kind } ] }`，`kind` ∈ `RSS` / `HTML` / `JSON`。
被跳过的源仍会返回，并带 `skipped: true` 与 `reason`，供界面标注「已知不可达」。

## §11.4 配置项（`application.properties`）

> **v1 修订（2026-10-28）**：原表只登记了 7 个键，而 `application.properties` 实际有 **28 个生效键**；且 `kb.briefing.folder` 的默认值写成了「AI简报」，仓库里的实际值是 `AI时代笔记`。下表**以 `application.properties` 为准**逐键重写。
> 中文值必须写成 `\uXXXX` 转义（`.properties` 按 ISO-8859-1 解码，直接写中文会变乱码）。

### §11.4.1 每日简报 `kb.briefing.*`（13 键）

| 键 | 仓库实际值 | 说明 |
|---|---|---|
| `kb.briefing.enabled` | `true` | 总开关。**关闭后：定时任务与启动补抓不跑；手动 `POST /run` 返回 403 且不外连** |
| `kb.briefing.owner` | `14chen` | 归属账号名。**为空时定时任务不执行**（避免误写） |
| `kb.briefing.cron` | `0 30 18 * * *` | **6 段**（秒 分 时 日 月 周），也兼容 5 段 |
| `kb.briefing.per-source` | `5` | 每源最多收录条数 |
| `kb.briefing.translate` | `true` | 英文标题/摘要是否翻成中文（失败保留英文，不影响 run） |
| `kb.briefing.translate-provider` | `auto` | `auto`（有 key 走 DeepL，否则 MyMemory）/ `deepl` / `mymemory` / `none` |
| `kb.briefing.deepl-key` | 空 | DeepL key；免费版以 `:fx` 结尾即自动走 api-free |
| `kb.briefing.deepl-endpoint` | 空 | 显式覆盖 DeepL 端点（一般留空） |
| `kb.briefing.fetch-article` | `true` | 是否抓文章页拿更充实的摘要与首图（失败静默跳过） |
| `kb.briefing.max-images` | `20` | 单次运行最多下载几张配图 |
| `kb.briefing.skip-sources` | `importai` | 跳过抓取的源 id，逗号分隔（不请求、不计失败、仍出现在源清单） |
| `kb.briefing.folder` | `AI时代笔记` | 归属目录名；**不存在时用根目录，不自动建目录** |
| `kb.briefing.tags` | `AI简报` | 打给简报笔记的标签，逗号分隔 |

### §11.4.2 开源周报 `kb.weekly.*`（7 键 + 1 个默认值键）

| 键 | 仓库实际值 | 说明 |
|---|---|---|
| `kb.weekly.enabled` | `true` | 总开关；关闭后定时任务不跑，**手动 `POST /api/weekly/run` 返回 403 且不外连** |
| `kb.weekly.owner` | `14chen` | 归属账号名；为空时定时任务不执行 |
| `kb.weekly.cron` | `0 30 18 * * FRI` | 每周五 18:30 |
| `kb.weekly.per-source` | `5` | 每源最多收录条数 |
| `kb.weekly.folder` | `开源周报` | 顶级目录名，下面按 ISO 周建子目录 |
| `kb.weekly.tags` | `开源周报` | 归档笔记标签 |
| `kb.weekly.gitee-json` | `data/weekly-gitee.json` | Gitee 数据文件（浏览器脚本产出） |
| `kb.weekly.snapshot-lookback-days` | `7`（未写进 properties，取代码默认） | star 快照最多回溯多少天 |

### §11.4.3 归档 `kb.archive.*`（7 键）

> 归档**只搬家、不删数据**，全程本地数据库操作，**不联网**。

| 键 | 仓库实际值 | 说明 |
|---|---|---|
| `kb.archive.enabled` | `true` | 关闭后 `POST /api/archive/run` 返回 `200` + `status:"disabled"`（不执行任何搬迁） |
| `kb.archive.weekly-keep-weeks` | `8` | 周报保留最近几周，更早的移入归档目录 |
| `kb.archive.briefing-keep-days` | `90` | 简报保留最近多少天 |
| `kb.archive.cron` | `0 15 4 * * *` | 每天 04:15 |
| `kb.archive.weekly-folder` | `开源周报` | 待归档的周报顶级目录 |
| `kb.archive.weekly-archive-folder` | `归档` | 周报归档去向 |
| `kb.archive.briefing-archive-folder` | `AI简报归档` | 简报归档去向 |

### §11.4.4 自动标签 `kb.autotag.*`（1 键）

| 键 | 仓库实际值 | 说明 |
|---|---|---|
| `kb.autotag.enabled` | `false` | 默认关闭（先让人观察效果，避免乱打标签）。关闭时 `POST /api/autotag/run` 返回 `200` + `{scanned:0,tagged:0,tags:[]}`，不写任何标签 |

## §11.5 定时与补抓

- `BriefingScheduler` 按 `kb.briefing.cron` 触发，**只在 `enabled` 且 `owner` 非空时执行**
- `BriefingStartupCatchUp` 在应用启动就绪后异步检查「今天是否已跑过」；若今天还没跑且已过今天的生成时刻，立刻补跑一次
- 两者**共用同一把并发锁**，不会并发出两条简报
---

# 十二、优化轮新增接口（2026-10-27）

## §12.1 搜索增强（`GET /api/search`）

原有 `q` / `page` / `size` 之外，新增四个可选参数。**不传时行为与改造前完全一致。**

| 参数 | 说明 |
|---|---|
| `folderId` | 只看该目录下的笔记，**含所有子目录**（递归 CTE；软删目录不算）。`folderId=0` 表示「未分类」 |
| `tagId` | 只看带该标签的笔记 |
| `from` / `to` | `YYYY-MM-DD`，按 `updated_at` 过滤，**含起止当天** |
| `sort` | `relevance`（默认，bm25）/ `updated`（按更新时间倒序） |

非法日期、`from > to`、非法 `sort` 一律 **400 VALIDATION_FAILED**。

结果项新增字段 **`snippet`**：

~~~json
{ "id": 12, "title": "权限认证框架说明", "snippet": "轻量级 Java **权限**认证框架，让鉴权变得简单优雅。", "...": "..." }
~~~

- **纯文本 + markdown 粗体**（命中处 `**词**`），**不含任何 HTML**
- 围绕正文里第一个命中的关键词，前后各约 40 字符；两端被截断时补 `…`
- 正文里没命中（只命中标题/标签）→ `null`
- 开窗按字符且避开代理对，中文与 emoji 不会被切坏
- 旧字段 `highlight`（HTML `<em>`）保持不变，供老前端使用

## §12.2 附件体检（`GET /api/attachments/health`）

~~~json
{ "total": 4, "ok": 3, "missing": 1,
  "missingItems": [ { "id": 1, "noteId": 1, "noteTitle": "AI的时代，REA 逆向",
                      "originalName": "技能测试1.png", "sizeBytes": 63863 } ],
  "orphans": [ { "storedName": "1/abc.png", "sizeBytes": 79 } ] }
~~~

- `missingItems`：表里有记录但磁盘文件不存在（只有当前空间）
- `orphans`：磁盘上有文件但表里没记录
- 路径检查一律走 `resolveStoredPath`（normalize + 前缀校验），非法 `stored_name` 记为缺失、不越界读盘

## §12.3 归档（非破坏性）

| 接口 | 说明 |
|---|---|
| `POST /api/archive/run` | 立刻归档一次，返回 `{ runId, movedFolders, movedNotes, skipped, status }` |
| `GET /api/archive/runs?limit=10` | 归档历史 |

规则（**只搬目录 / 改 `folder_id`，绝不删除、绝不进回收站**）：

| 对象 | 判定 | 搬到 |
|---|---|---|
| 周报周目录 `开源周报/2026-W43` | ISO 周早于「最近 N 周」 | `开源周报/归档/2026-W43` |
| 简报笔记 `AI 简报 YYYY-MM-DD` | 日期早于 M 天 | `AI简报归档/YYYY-MM/` |

配置：`kb.archive.enabled` / `weekly-keep-weeks`(8) / `briefing-keep-days`(90) / `cron`(每天 4:15)。
搬迁在事务内完成并**校验数量**（前后不一致则回滚），重复跑幂等。

## §12.4 自动打标签（默认关闭）

| 接口 | 说明 |
|---|---|
| `POST /api/autotag/run` | 跑一次，返回 `{ scanned, tagged, tags }` |

规则：只处理**完全没有标签**的笔记；固定词表（前端/后端/数据库/AI/运维/生活）；
**必须命中 ≥2 个不同关键词**；一篇最多打 2 个标签。
**默认 `kb.autotag.enabled=false`** —— 中文词边界模糊，误打标签清理成本高，建议先手动跑看建议。

## §12.5 开源周报

| 接口 | 说明 |
|---|---|
| `POST /api/weekly/run` | 立刻生成一次（GitHub 5 + Gitee 5，每个项目一篇笔记） |
| `GET /api/weekly/runs?limit=10` | 运行历史 |

定时 `kb.weekly.cron=0 30 18 * * FRI`；应用启动时若当前 ISO 周没有成功记录会自动补跑一次。

每篇正文在「一句话价值 / 推荐理由 / 适用人群」之后附一节 `## 傻瓜教程（自动生成）`：8 个三级小节（0 这是什么 / 1 动手前先备好 / 2 安装 / 3 跑通第一个例子 / 4 三个容易踩的坑 / 5 想继续深入 / 6 原文速览 / 7 备注）。命令与代码块摘自 `RepoTutorial` 从 README 解析出的围栏块（安装段与示例段按内容去重），散文是模板；README 抓不到时明说、不编命令。旧笔记不回溯。
Gitee 数据来自 `data/weekly-gitee.json`（由 `tools/weekly/fetch-gitee.mjs` 用无头浏览器抓，
因为 `gitee.com/explore/*` 有 Nox JS 挑战，普通 HTTP 一律 405）。

## §12.6 长文速览（计算字段，不落库）

`GET /api/notes/{id}` 响应新增 **`digest`**：

~~~json
{ "digest": { "text": "第一个标题\n第一段首句\n第二段首句", "sections": ["...", "..."] } }
~~~

- 正文 < 800 字 → 字段为 `null`
- 抽取式（从正文挑句子），**不是 AI 生成**；跳过代码块 / 列表 / 表格 / 图片 / 引用
- **绝不修改笔记正文**

## §12.7 Web App Manifest 的 MIME

`GET /manifest.webmanifest` **必须**返回 `application/manifest+json`。
Spring 的 `MediaTypeFactory` 不认识 `.webmanifest`，默认会给 `application/octet-stream`，
而 Chrome 会拒绝这种类型的 manifest（PWA 的「添加到主屏幕」随之失效）。
因此由 `com.kb.config.PwaManifestController` 精确接管该路径显式声明类型 —— 改动时别把它删掉。

## §12.8 单篇导出的无扩展名别名（`GET /api/export/notes/{id}`）

`ExportController` 上写的是 `@GetMapping({"notes/{id}", "notes/{id}.md"})` —— **同一个 handler 的两个路径**，所以下面两种写法等价：

| 路径 | 说明 |
|---|---|
| `GET /api/export/notes/{id}.md` | 契约登记的形式，返回 `text/markdown` 正文 |
| `GET /api/export/notes/{id}` | 同一 handler 的别名（无扩展名），返回内容与上者完全一致 |

两者都**只给正文、不带附件**；要连图片一起拿走请用 `GET /api/export/notes/{id}.zip`。

> **界面只用 `.zip` 与 `.md`**。这个无扩展名别名是历史遗留的第二个映射，保留用于兼容旧链接，**新代码不要再依赖它**。
> 若将来要收敛，先 grep 前端 `api/io.ts` 与 `tools/verify/*` 确认无人调用，再删 `ExportController` 里的 `"notes/{id}"` 这一项。

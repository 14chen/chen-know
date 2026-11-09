# 全量重构 · 实现契约（冻结版 v1）

> 本文件是并行开发的**唯一接口真源**。需要变更 → 回报 Lead，由 Lead 修订并通知全部相关方。
> 前置阅读：`docs/API.md`（REST 契约）、`frontend/PROTOTYPE.md`（原型阶段的接口约定，仍有效）。

## 1. 目标

把原型（单编辑器原型）扩成**功能完整的知识库前端**，能力对齐现有零构建旧版，一个不丢：

| # | 视图 | 路由 | 说明 |
|---|---|---|---|
| 1 | 笔记 | `#/notes/:id` | 目录树 + 笔记列表 + 单栏 Typora 编辑器（**原型已有，需扩目录树与列表操作**） |
| 2 | 搜索 | `#/search?q=&tag=&folderId=` | 全文搜索，`<em>` 高亮，标签/目录筛选，分页 |
| 3 | 标签 | `#/tags` | 标签列表（含 count）、增删改色、点击跳搜索 |
| 4 | 反链 | `#/backlinks?note=` | 反向引用 + 出链（resolved / dangling） |
| 5 | 历史版本 | `#/versions?note=` | 版本列表、内容查看、与当前版本 diff、回滚 |
| 6 | 收藏 | `#/favorites` | 收藏列表，取消收藏，点击打开 |
| 7 | 最近浏览 | `#/recent` | 按 `viewedAt` 倒序，条数切换 |
| 8 | 回收站 | `#/trash` | 笔记/目录两区，恢复/彻底删除/清空 |
| 9 | 导入导出 | `#/io` | 导出单篇/全部 ZIP；导入 md/zip，先预览再确认 |
| 10 | 统计 | `#/stats` | 计数卡片 + 14 天柱状图 + 最近更新 |
| 11 | 成员管理 | `#/admin` | 仅管理员：用户 CRUD + 邀请码 |

## 2. 路由与视图注册（骨架由 `f-shell` 实现）

- **必须用 hash 路由**，格式 `#/<view>[/<id>][?k=v]`
- 视图在 `src/views/registry.ts` 注册（`f-shell` 拥有该文件），每项形如：
  ```ts
  { id: 'search', title: '搜索', component: SearchView }
  ```
- 侧栏/顶栏的功能入口由注册表生成；**`adminOnly: true` 的项对成员隐藏**
- 未知路由 → 回退到笔记视图并提示一次

## 3. 视图接口（冻结，见 `src/views/types.ts`）

视图是普通 React 组件，接收 `{ ctx: ViewContext }`：

```tsx
export default function SearchView({ ctx }: ViewProps) {
  // ctx.navigate / ctx.toast / ctx.confirm / ctx.openNote / ctx.notes /
  // ctx.knownTitles / ctx.tree / ctx.refreshNotes / ctx.refreshTree /
  // ctx.relativeTime / ctx.formatDate / ctx.formatBytes / ctx.params ...
}
```

**硬约束**：
- 视图**不得 import `@/shell/**`**（避免与外壳互相阻塞）。需要什么能力就加进 `ViewContext` —— 那是 Lead 的文件，先回报再改。
- **不得用原生 `alert()` / `confirm()` / `prompt()`** —— 用 `ctx.toast` 与 `ctx.confirm`
- 所有来自服务端的字符串一律走 `esc`/`textContent` 语义（React 默认转义即可），**唯一例外**是搜索高亮 `highlight`：它含服务端生成的 `<em>`，必须**先经 DOMPurify 白名单净化**（只允许 `em`/`mark`/`b`/`strong`/`i`，不允许任何属性）再 `dangerouslySetInnerHTML`。旧版已有此实现，可参考
- 列表渲染要处理**空状态、加载态、错误态**三态
- 卸载时清理定时器与未完成请求（AbortController）

## 4. 响应式规范（本次新增的硬要求）

**四个断点**（`f-shell` 负责建立机制，每个视图负责自己的内容适配）：

| 断点 | 宽度 | 布局要求 |
|---|---|---|
| 桌面 | ≥1280px | 侧栏常驻 288px；视图内可多列 |
| 笔记本 | 1024–1279px | 侧栏常驻但收窄（240px）；视图内多列最多 2 列 |
| 平板 | 768–1023px | **侧栏变抽屉、默认收起**，顶栏出现菜单按钮；视图内多列降为 1–2 列 |
| 手机 | <768px | **单栏**；抽屉全宽；所有多列布局降为**单列**；表格允许横向滚动；工具栏换行为图标行 |

**触摸适配**：`(pointer: coarse)` 下可点区域最小 **44×44px**；悬停才出现的操作在触摸设备上必须常驻或可通过点按唤出。

**必须实测**（不接受「CSS 写了就算」）：每个断点至少一个视图截图 + 关键断言（侧栏是否常驻、抽屉是否可开合、有无横向溢出）。

**不得出现横向滚动条**：`document.documentElement.scrollWidth <= clientWidth` 必须在四个断点都成立。

## 5. 文件所有权（避免并行冲突）

**`f-shell` 拥有**
```
frontend/src/App.tsx
frontend/src/main.tsx
frontend/src/index.css
frontend/src/shell/**
frontend/src/styles/shell.css
frontend/src/styles/components.css   （基础组件样式可扩充）
frontend/src/styles/base.css
frontend/src/components/**           （基础组件可扩充）
frontend/src/api/{client.ts,auth.ts,notes.ts,attachments.ts,folders.ts}
frontend/src/views/registry.ts
```

**`f-views-note` 拥有**
```
frontend/src/views/{search,tags,backlinks,versions,favorites,recent}/**
frontend/src/styles/views-core.css
```

**`f-views-admin` 拥有**
```
frontend/src/views/{trash,io,stats,admin}/**
frontend/src/styles/views-admin.css
```

**共同禁止**：`package.json`、`vite.config.ts`、`tsconfig*.json`、`backend/**`、`docs/**`、
`frontend/*.md`、`frontend/src/api/types.ts`、`frontend/src/views/types.ts`、`frontend/src/editor/**`。
需要加依赖或改共享类型 → **回报 Lead**，不要自己动。

## 6. 与后端的对接

全部端点与字段名见 **`docs/API.md`**；TypeScript 类型见 **`src/api/types.ts`**（已由 Lead 冻结）。

**调用方式**：用 `request()`（`@/api/client`）直接发请求即可，各视图只管自己那一组端点：

```ts
import { request } from '@/api/client'
import type { Page, SearchHit } from '@/api/types'

const page = await request<Page<SearchHit>>(`/api/search?q=${encodeURIComponent(q)}`)
```

**几个容易踩的契约细节**（都已在 API.md 与 types.ts 注明）：
- `GET /api/tags`、`GET /api/notes/{id}/versions` 返回**裸数组**，不是分页信封
- `GET /api/recent` 的时间字段是 **`viewedAt`**；`GET /api/trash` 的目录项含 **`noteCount`**（含子孙）
- 出链的 `dangling` 是**纯字符串数组**
- 列表按 `updated` 排序时，**置顶笔记始终排最前**
- 笔记列表接口**不返回 `content`**，需要正文要单独 `GET /api/notes/{id}`
- 空 PATCH `{}` 会返回 **400**（有意设计，用于暴露字段名拼写错误）
- `folderId=0` 表示**未分类**（`folder_id IS NULL`），不传表示不过滤

## 7. 交付与自测要求（每个实现者都要做）

1. `npm run build` **0 个 TS 错误**（`strict` / `noUnusedLocals` / `erasableSyntaxOnly` 全开）
2. 用**真后端**跑通自己负责的视图（隔离实例见下）
3. 四断点各至少一张截图 + 横向溢出断言
4. 空态 / 加载态 / 错误态三种情形都实测
5. 贴出真实命令与真实输出；**不接受「应该没问题」**

**开发用隔离实例**（避免碰用户真实数据）：
```
java -jar backend\target\knowledge-base-0.0.1-SNAPSHOT.jar --kb.data-dir=%TEMP%\kb-dev-data
dev server: npm run dev  →  http://localhost:5173/proto/index.html
演示账号：demo / DemoPass123!
```
演示库里有 6 篇覆盖各种 Markdown 形态的笔记；**不要修改或删除它们**（Lead 要用它们做最终截图）。需要测试数据请自己新建。

## 8. 已知的坑（前人踩过，别再踩）

- **Vite 8 底层是 rolldown**（不是 rollup），报错形态不同
- **TypeScript 6 已废弃 `baseUrl`**，用了直接报错；`paths` 相对 tsconfig 自身解析
- **严禁 `enum` / `namespace`**（`erasableSyntaxOnly` 会拒绝）
- **本机 PowerShell 是 5.1**：含中文的 `.ps1` 必须存成 **UTF-8 with BOM**
- CodeMirror 的**块级装饰只能由 StateField 提供**，插件里会直接抛错
- 编辑器的行类名形如 `cm-kb-h1` / `cm-kb-chip` / `cm-kb-checkbox`，高亮 span 的类名是哈希值（不要断言类名，断计算样式）

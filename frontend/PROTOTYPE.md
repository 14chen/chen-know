# 编辑器原型 · 实现契约（冻结版 v1）

> 本文件是原型阶段两个实现者之间的**唯一接口真源**。
> 需要变更接口 → 回报 Lead，由 Lead 修订本文件并通知另一方。**不要私自改接口。**

## 0. 目标与范围（刻意收窄）

**做**：一个能让你判断「手感」和「观感」的最小闭环 —— 登录 → 选一篇笔记 → 用 **单栏 Typora 式编辑器**编辑 → 保存 → 刷新确认持久化。

**不做**（原型阶段明确排除，不要顺手加）：搜索 / 标签 / 回收站 / 导入导出 / 统计 / 成员管理 / 完整目录树交互（重命名、拖拽、新建）/ 右栏信息面板（大纲/反链/版本）。

## 1. 工程与构建

| 项 | 值 |
|---|---|
| 目录 | `D:\deepseekhums\work\知识库\frontend` |
| 技术栈 | React 19 + TypeScript 6 + Vite 8（**Vite 8 底层是 rolldown**） |
| 构建 | `npm run build` = `tsc -b && vite build` |
| 产物 | `../backend/src/main/resources/static/proto`（已在 vite.config.ts 配好） |
| 访问 | 开发用 Vite dev server `http://localhost:5173/`（已配 `/api` 反代到 8080）；集成后用 `http://127.0.0.1:8080/proto/index.html` |
| 路由 | **必须用 hash 路由**（如 `#/notes/12`），避免后端需要 SPA fallback |

**严格编译选项**（脚手架默认，别关）：`strict`、`noUnusedLocals`、`noUnusedParameters`、`verbatimModuleSyntax`、`erasableSyntaxOnly`（**禁用 enum / namespace**）、`noFallthroughCasesInSwitch`。

**路径别名**：`@/*` → `src/*`（vite.config.ts 与 tsconfig.app.json 均已配好）。

## 2. 文件所有权（避免两人写同一文件）

**`p-shell` 拥有**：
```
frontend/index.html
frontend/src/main.tsx
frontend/src/App.tsx
frontend/src/index.css
frontend/src/styles/**          设计 token + 全局样式 + 基础组件样式
frontend/src/api/**             API 客户端
frontend/src/components/**      基础组件
frontend/src/shell/**           登录页、应用布局、笔记列表
```

**`p-editor` 拥有**：
```
frontend/src/editor/**          Typora 式编辑器全部实现（唯一对外入口见 §4）
frontend/editor-lab.html        仅开发用的独立测试台入口（Vite 生产构建只认 index.html，不会打进产物）
frontend/src/editor-lab.tsx     测试台挂载脚本
```
> 测试台用途：`npm run dev` 后访问 `http://localhost:5173/editor-lab.html` 即可单独调编辑器，
> 不必等 `p-shell` 的外壳就绪。测试台里请预置一段覆盖面广的示例 Markdown（标题/列表/任务/代码块/表格/引用/双链）。

**共同禁止**：`frontend/package.json`、`frontend/vite.config.ts`、`frontend/tsconfig*.json`、`backend/**`、`docs/**`。需要加依赖或改配置 → 报 Lead。

## 3. 设计 token（名字冻结；具体色值由 p-shell 定）

`p-shell` 必须在 `:root` 上定义以下**全部**变量，`p-editor` 只许引用、不许自己写颜色字面量：

```
间距   --sp-1 --sp-2 --sp-3 --sp-4 --sp-5 --sp-6 --sp-7
圆角   --r-sm --r-md --r-lg --r-xl --r-full
字号   --fs-xs --fs-sm --fs-base --fs-md --fs-lg --fs-xl --fs-2xl
行高   --lh-tight --lh-normal --lh-relaxed
动效   --ease --dur-fast --dur --dur-slow
层级   --z-dropdown --z-modal --z-toast
布局   --sidebar-w --editor-max
颜色   --bg --bg-subtle --bg-muted --surface --surface-raised
       --border --border-strong --text --text-secondary --text-muted
       --accent --accent-hover --accent-soft
       --danger --danger-soft --success --warning
       --code-bg --code-text
阴影   --shadow-sm --shadow --shadow-lg
```

**视觉方向（用户明确要求）**：现代精致 —— 大圆角、柔和阴影、微动效、更好的深色主题。

**主题机制**：`<html data-theme="light|dark">`；localStorage key 用 **`kb.theme`**（与旧版应用共用，切换主题时两版观感一致）。首次访问跟随 `prefers-color-scheme`。

## 4. 编辑器接口（本项目最关键的一条接口）

`p-editor` 导出（文件：`frontend/src/editor/MarkdownEditor.tsx`）：

```tsx
export interface MarkdownEditorProps {
  /** 受控值：Markdown 原文。外部切换笔记时整体替换 */
  value: string
  /** 每次内容变化回调（含正在输入的中间态） */
  onChange: (next: string) => void
  /** 当前笔记标题，用于 [[双链]] 自动补全时排除自身 */
  noteTitle?: string
  /** 已知笔记标题索引，供 [[双链]] 补全提示（p-shell 提供，可能为空数组） */
  knownTitles?: string[]
  /** 点击已渲染的 [[双链]] 时触发 */
  onWikiLinkClick?: (title: string) => void
  /** 粘贴图片时调用；返回可直接插入正文的 URL。抛错则由编辑器 toast 提示 */
  onUploadImage?: (file: File) => Promise<string>
  /** Ctrl/Cmd+S 触发 */
  onSave?: () => void
  readOnly?: boolean
  className?: string
}

export interface MarkdownEditorHandle {
  focus(): void
  /** 让编辑器重新读取 value（外部替换内容后调用，保持光标位置合理） */
  sync(): void
}

export const MarkdownEditor: React.ForwardRefExoticComponent<
  MarkdownEditorProps & React.RefAttributes<MarkdownEditorHandle>
>
```

**必须实现的行为**（这是用户要评估的核心，缺一不可）：
1. **Typora 行为**：光标所在的那一行（或选区所在行）显示 Markdown 源码；其余行渲染为最终效果
2. **渲染内容**（至少）：标题 `#`~`######`、粗体 `**`、斜体 `*`、行内代码 `` ` ``、删除线 `~~`、链接 `[文字](url)`、无序/有序列表、任务列表 `- [ ]`、引用 `>`、围栏代码块 ```（含语法高亮）、分隔线 `---`、表格
3. **`[[双链]]`**：非当前行时渲染成可点击的 chip；输入 `[[` 时弹出补全列表（数据来自 `knownTitles`，支持键盘上下选择 + Enter/点击插入，Esc 取消）；已有笔记与未创建笔记视觉上要能区分
4. **粘贴图片**：`paste` 事件里检测图片文件 → 调 `onUploadImage` → 插入 `![文件名](url)`
5. **快捷键**：`Ctrl/Cmd+S` → `onSave`；`Ctrl/Cmd+B` 加粗；`Ctrl/Cmd+I` 斜体；`Ctrl/Cmd+K` 插入链接；Tab 在列表内缩进
6. **中文输入法**：组合输入（IME composition）期间**不得**触发装饰器重排导致丢字或跳光标。必须实测
7. **性能**：≥50 KB 的文档输入不卡顿（装饰器只处理视口内可见范围）

## 5. 与后端的对接（全部已在 `docs/API.md` 冻结，直接照用）

| 用途 | 请求 |
|---|---|
| 会话探测 | `GET /api/auth/me`（401 = 未登录） |
| 登录 | `POST /api/auth/login` `{username,password}` |
| 登出 | `POST /api/auth/logout` |
| 笔记列表 | `GET /api/notes?size=200&sort=updated` → `{items,page,size,total}`，**不含 content** |
| 笔记详情 | `GET /api/notes/{id}` → 含 `content`、`title`、`tags` |
| 保存 | `PATCH /api/notes/{id}` `{title?, content?}` —— **仅内容或标题变化才产生历史版本** |
| 上传附件 | `POST /api/attachments` multipart 字段名 `file` → `{id,url,originalName,mimeType,sizeBytes}` |

**错误响应形状**：`{"error":{"code":"...","message":"..."}}`。401 时 p-shell 应回到登录页。

## 6. 交付标准（各自自测，贴真实输出）

**`p-shell`**：
1. `npm run build` 成功（0 TS 错误）
2. `npm run dev` 起得来，`http://localhost:5173/` 返回页面
3. 用**真后端**登录（`http://127.0.0.1:8080` 已配反代），登录页有错误提示分支
4. 笔记列表能列出真后端里的笔记，点击能加载正文进编辑器
5. 深色/浅色主题切换生效，刷新后保持
6. 贴出关键截图或 DOM 断言

**`p-editor`**：
1. `npm run build` 成功（0 TS 错误）
2. §4 的 7 条行为**逐条实测**，贴真实输出/截图
3. 独立可测：`src/editor/` 不得 import `src/shell/**`（只允许 import `@/styles` 的 CSS 变量与 `@/components` 里的纯展示组件；**不确定就先问 Lead**）
4. 中文输入法必须用 `compositionstart/end` 处理并说明验证方式

## 7. 现有可用资源

- 后端已在 `http://127.0.0.1:8080` 运行（jar 已含 `static/proto/`）
- 旧版完整应用在 `http://127.0.0.1:8080/`，**可随时对照参考它的交互与文案**
- `docs/API.md` 是完整 REST 契约（含所有视图用到的端点）
- 旧版前端源码在 `backend/src/main/resources/static/assets/js/`，可参考现有交互逻辑（**但不要照搬 DOM 结构与样式**）

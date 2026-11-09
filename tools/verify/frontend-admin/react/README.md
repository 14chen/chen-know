# React 管理类视图验收 harness（trash / io / stats / admin）

> 这是**仓库外/内都能跑**的独立验收装置：Vite harness 页面把**真实交付文件**
> （`frontend/src/views/{trash,io,stats,admin}/index.tsx`）挂到一个假的 `ViewContext` 上，
> 用 CDP 驱动 headless Edge 逐条断言，并把四断点截图落到 `shots/`。
>
> 之所以不用真外壳：外壳（`AppShell` 的路由/视图切换）由 `f-shell` 并行开发，
> harness 直接 `alias @ → frontend/src`，因此**跑的就是真实视图代码**，不依赖外壳进度。

## 一键跑

```powershell
powershell -File tools\verify\frontend-admin\react\run-all.ps1
# 可选参数：-Backend http://127.0.0.1:8080 -User demo -Password DemoPass123! -VitePort 5199 -Node <node.exe> -FrontendArg <frontend 目录>
```

前置条件：

| 项 | 说明 |
|---|---|
| 真后端 | 默认 `http://127.0.0.1:8080`，演示账号 `demo / DemoPass123!`（`-Backend/-User/-Password` 可换） |
| Node | 默认用 DSH 自带 node，找不到时回退 `node`（PATH） |
| vite | 取 `frontend/node_modules/vite`（harness 用 junction 复用依赖，不重复安装） |
| 端口 | `8791`（mock/代理）与 `5199`（vite dev），脚本会先释放 8791 |
| Edge | `frontend/src/editor/lab/cdp.mjs` 里已内置候选路径 |

脚本会自己：登录 → 起 vite → 预热 → 按模式起/停 mock → 跑 4 个模式 → 释放端口。

## 五个模式（run-all.ps1 依次跑完）

| 模式 | 后端 | 覆盖 |
|---|---|---|
| `main` | mock **proxy** → 真后端（注入会话 Cookie） | 72 条：trash 恢复/彻底删除/清空 + 二次确认措辞 + refresh 联动、io 预览/导入/边界/导出下载 URL、stats 14 柱与真实计数、admin 成员 CRUD + 邀请码 + 自我保护 + 409 字段级错误、四断点截图与横向溢出、390px 表格滚动提示 |
| `mock` | mock **direct**（固定夹具） | 14 条：千分位 `4,242`、`5.0 MB`、14 柱含 6 个 0 值日、preview **每个字段**（title/sourceFile/folder/tags）各注入一次 XSS 载荷只作文本、`total=0+errors` 边界、最近更新渲染 |
| `io-images` | mock **direct** | 36 条：**导入图片/文件夹**（本轮新增）—— accept 含图片、`webkitdirectory` 输入、四种文件组合（只有 md / md+图 / 文件夹 / zip）各自提交的 multipart filename、缺图明细与**不阻断确认**、结果里的 `imagesImported`、拖拽文件夹递归单测、`kindOf`/体积提示、缺图弹窗四断点无溢出 |
| `states` | mock proxy（`--delay 1200`） | 5 条：挂载瞬间骨架屏 → 数据到达替换、回收站空态、邀请码空列表文案；顺带产 `state-loading-stats.png` / `state-empty-trash.png` |
| `error` | **mock 停掉** | 6 条：三个视图都展示失败提示 + 重试按钮 |

单跑某一个：`node drive.mjs main|mock|io-images|states|error`（需自己先起 vite 与对应 mock）。

## ⚠️ 后端点名规则（重要）

```powershell
# 唯一正确的跑法：测试实例 8090
powershell -File tools\verify\frontend-admin\react\run-all.ps1 -Backend http://127.0.0.1:8090
```

**`8080` 是用户真实实例，任何验收都不得指向它**（只允许只读地看一眼 `/api/health`）。
`-Backend` 的默认值是 `http://127.0.0.1:8080`（历史遗留），**跑之前务必显式传 `-Backend http://127.0.0.1:8090`**。
`mock` / `io-images` / `error` 三个模式不连真后端，可以随便跑。

## 导入图片 / 文件夹（docs/IMPORT-IMAGES.md §8）

前端要点集中在 `src/api/io.ts`（纯逻辑、可单测）+ `src/views/io/index.tsx`（UI）：

- **multipart filename = 相对路径**：文件夹选择用 `file.webkitRelativePath`，多选/ZIP 用 `file.name`（契约 §2）
- **拖拽文件夹**：`DataTransferItem.webkitGetAsEntry()` 递归收集，用 `entry.fullPath` 还原相对路径
  （拖拽来的 `File.webkitRelativePath` 是空的，只有 `fullPath` 能还原 —— 这里踩过一次坑，`collectEntryFiles` 单测专门盯它）
- **图片不单独产生笔记**，只作为索引素材；纯图片批次给「请同时选择 .md」的提示，而不是「解析失败」
- **缺图不阻断**：`missingImages` 用 warning 样式列出（文件 / 行号 / 路径 / 原因），确认按钮始终可点
- 测试注入：`__H.setInputFiles(index, specs)`（specs 可带 `path` 模拟文件夹选择）/ `__H.dropFiles(...)`

## 产物

- `shots/`：`stats|admin` × `1440×900 / 1180×800 / 900×700 / 390×844` 共 8 张 + 加载态/空态 2 张
- `main-run.txt` 等：每个模式的完整断言输出
- 断言里含 `scrollWidth <= clientWidth` 的实测值，四断点都必须成立

## 清理

验收会在演示库造少量 `QA-*` 夹具（回收站流程、导入流程、一个用户、一个邀请码），
`drive.mjs` 结束前会自行清理；也可单独兜底：

```powershell
node tools\verify\frontend-admin\react\cleanup.mjs     # 需要 mock 代理在 8791 上运行
```

⚠️ **演示实例是多位实现者共用的**：`清空回收站` 这一步会清掉**当时的整个回收站**
（不只我的夹具）——这是验收要求的行为，但请知悉。演示笔记 id 1–6 全程未被修改。

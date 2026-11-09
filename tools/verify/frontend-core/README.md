# frontend-core 验收夹具（笔记类核心视图）

**这是什么**：个人知识库前端**核心视图**的契约验收脚本 —— 一个本地 mock 后端 + 两套断言（静态资源 92 项、浏览器内视图 71 项）+ 一个真后端联调冒烟驱动器。
覆盖：`index.html` 三栏骨架、`assets/css/app.css`、`assets/js/{api,ui,store,markdown,main}.js`、`views/notes.js`、`views/{search,tags,backlinks,versions,favorites,recent}.js`、顶栏全局搜索（`#global-search` / Ctrl+K）。

> ⚠️ **mock 不是交付物**。`mock-server.mjs` 只按 `docs/API.md` 的**固化结构**回放响应（含故意注入的 XSS 载荷），用于在没有后端时验收前端；它不实现任何业务逻辑，也不进 `backend/src/main/resources/static`。
> 本目录**不含** admin / trash / io / stats 视图的夹具（见 `tools/verify/frontend-admin/`，由另一位实现者维护）。

## 目录

| 文件 | 作用 |
|---|---|
| `repo.mjs` | 路径推导：从脚本位置向上找含 `docs/SCHEMA.md` 的仓库根 → 前端静态目录；浏览器探测 |
| `mock-server.mjs` | 静态服务 + mock API + 把探针与验收台注入到 `index.html`（`/__harness.html` → `/__test.mjs`） |
| `harness-views.js` | 浏览器内验收台（72 项）：6 个视图、顶栏搜索、XSS、卸载不重复请求、无 console 错误 |
| `harness-login.js` | 浏览器内用例（7 项）：注册成功但自动登录失败时的降级提示与「不踢回空表单」 |
| `assert-dom.mjs` | 92 项：骨架 id/class、CSS 选择器、全模块 import 链 200、运行时 DOM 断言 |
| `run-mock-suite.mjs` | **一条命令跑完 A/B/C 三套**（起 mock → 三次 headless 浏览器 → 汇总） |
| `smoke-proxy.mjs` | 真联调用反向代理：把验收台注入真后端页面（不改后端任何文件） |
| `cdp-smoke.mjs` | 用 CDP（真实时间）驱动真后端跑 `smoke-flow.js` |
| `smoke-flow.js` | 真后端冒烟流程：登录 → 建目录 → 建笔记 → 改正文 → 搜中文 → 打标签 → 反链视图 → 版本 → 标签/最近/收藏 |

## 前置条件

- **Node.js ≥ 20**（实测 v22）
- **Edge 或 Chrome**（headless）；自动探测常见安装路径，或设置 `EDGE="C:\...\msedge.exe"`
- 端口：mock 用 **8099**；真后端联调另需 **8083**（后端）与 **9225**（CDP）
- 脚本只读前端文件；所有产物写到 `%TEMP%\kb-verify\`（Linux/macOS 为 `$TMPDIR/kb-verify`）
- **不写死机器路径**：仓库根由 `repo.mjs` 从脚本所在目录向上查找 `docs/SCHEMA.md` 得到，换机器/换目录可直接跑

## 从零复跑（mock 两套，一条命令）

```powershell
node tools\verify\frontend-core\run-mock-suite.mjs
```

期望输出：`A) DOM/资源断言 92/92` + `B) 视图验收台 72/72` + `C) 注册自动登录失败分支 7/7` + `合计失败 0 项`；退出码 0。

分步（等价）：

```powershell
# 1) 起 mock（另开一个终端，保持运行）
node tools\verify\frontend-core\mock-server.mjs            # 默认 8099
# 2) 产出运行时 DOM（供 assert-dom 的运行时断言使用）
& $env:EDGE --headless=new --disable-gpu --user-data-dir=$env:TEMP\kb-verify\p1 `
  --virtual-time-budget=20000 --dump-dom "http://127.0.0.1:8099/#/notes?note=1" > $env:TEMP\kb-verify\dom.html
# 3) 92 项
$env:RUNTIME_DOM="$env:TEMP\kb-verify\dom.html"; node tools\verify\frontend-core\assert-dom.mjs
# 4) 71 项（浏览器内验收台）
& $env:EDGE --headless=new --disable-gpu --user-data-dir=$env:TEMP\kb-verify\p2 `
  --virtual-time-budget=80000 --dump-dom "http://127.0.0.1:8099/__harness.html"
```

## 真后端联调冒烟（可选，需自行起后端）

```powershell
# 1) 起真后端（建议用独立空库，避免与他人数据互相影响；8083 避开 8080）
java -jar <backend>\target\knowledge-base-0.0.1-SNAPSHOT.jar --server.port=8083 --kb.data-dir=$env:TEMP\kb-smoke\data
# 2) 起 headless 浏览器并开 CDP
& $env:EDGE --headless=new --disable-gpu --remote-debugging-port=9225 --user-data-dir=$env:TEMP\kb-smoke-edge about:blank
# 3) 跑流程（真实时间；会打印请求时间线，含每个请求耗时）
node tools\verify\frontend-core\cdp-smoke.mjs            # 期望 21/21
```

注意：**fat jar 里打包的是打包时刻的静态资源**。若刚改过前端，要么重新 `package`，要么用 `smoke-proxy.mjs` 以反向代理方式跑：

```powershell
node tools\verify\frontend-core\smoke-proxy.mjs        # 8098 → 8083，注入验收台
& $env:EDGE --headless=new --virtual-time-budget=90000 --dump-dom "http://127.0.0.1:8098/__harness.html"
```

## 约定与边界

- 所有断言都打在**真实浏览器**里（headless Edge + `--dump-dom` 或 CDP），不是静态 grep
- mock 的夹具数据是**故意含 XSS 载荷**的（搜索结果标题/摘要、标签名、收藏标题、笔记正文），用于验证 DOMPurify 白名单与 `textContent` 转义
- 契约形状随 `docs/API.md` 固化：`/api/tags`、`/api/notes/{id}/versions` 为裸数组；`/api/favorites` 为分页信封；`/api/recent` 为 `{items:[…viewedAt]}`；`/api/notes/{id}/links` 的 `resolved[].{noteId,title,folderId}`、`dangling` 为纯字符串数组
- 本目录脚本不属于运行时交付物，改动它们不影响应用

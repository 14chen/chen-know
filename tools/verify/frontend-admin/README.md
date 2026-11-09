# tools/verify/frontend-admin — 前端管理类视图验收脚本

> 本目录只覆盖**管理类四视图**（回收站 / 导入导出 / 统计 / 成员管理）。
> 外壳与笔记核心视图（布局 / 路由 / 编辑器 / 搜索 / 标签 / 反链 / 版本）的验收脚本在同级
> `tools/verify/frontend-core/`，由另一位实现者维护 —— 两边互不依赖，可分别复跑。

## 这是什么

**前端四个管理类视图（回收站 / 导入导出 / 统计 / 成员管理）的契约验收脚本**：
用一个复刻 `docs/API.md` 冻结契约的 **mock 后端**驱动**真实 headless Edge**，
在真实浏览器里跑 100+ 条交互断言，并逐视图加载真实外壳（`index.html` + `main.js` + hash 路由）。

它不是单元测试，而是「契约 + 真实渲染」的端到端证据生成器：字段名对不上会**直接暴露**，
不会被任何归一化逻辑吞掉。

> ⚠️ **mock 后端不是交付物。** `mock.js` 只在验收时扮演后端角色（假数据 + 请求日志），
> 生产代码不依赖它。**真实后端的测试在 `backend/src/test/`**（JUnit / Maven），
> 端到端验收规格见 `docs/VERIFY.md`。

## 目录内容

| 文件 | 作用 |
|---|---|
| `verify.ps1` | 入口。静态检查 → 起 mock → 跑断言 → 真机加载 → 停 mock，输出 `RESULT: passed/failed` |
| `mock.js` | 三合一：`direct` mock 后端 / `proxy` 反代真实后端 / `probe` 只读契约探测 |
| `drive.html` | 浏览器内驱动脚本：以真实 `ui.js` + `api.js` 构造 ctx，逐视图驱动并断言 |
| `dump.ps1` | 用 headless Edge 加载 URL 并 `--dump-dom` 落盘（含虚拟时间预算，保证异步渲染完成） |
| `README.md` | 本文件 |

脚本**不含任何写死的仓库路径**：仓库根由 `verify.ps1` 从自身位置向上查找含 `docs/SCHEMA.md` 的目录推导，
所以整个 `frontend-admin/` 目录可以整体移动到任意位置（`-HarnessDir` / `-Root` 也可显式覆盖）。

## 前置条件

- **Node.js** 在 PATH 上（`node --version`；脚本用 Node 起 mock、做 multipart 探测、跑 `node --check`）
- **Microsoft Edge** 已安装（默认找 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，
  找不到会回退 `C:\Program Files\Microsoft\Edge\...\msedge.exe`）
- **本机 8791 端口空闲**（脚本会先杀掉占用它的陈旧监听进程；换端口用 `-Port`）
- 浏览器临时 profile 与 DOM dump 落在 `%TEMP%\kb-web-admin-verify\`，不在仓库里

## 从零复跑

```powershell
# 标准跑法（mock 后端 + 100+ 交互断言 + 4 视图真机加载 + XSS 检查）
powershell -File tools\verify\frontend-admin\verify.ps1
```

脚本自己完成：清端口 → 起 mock → 轮询 `/api/health` 就绪 → 跑断言 → 停 mock → 回显 `listeners left: 0`。
**不依赖任何预先存在的进程或会话变量**；退出码 `0` = 全绿，`1` = 有失败。

### 参数

| 参数 | 用途 |
|---|---|
| `-Neg` | **负向对照**：注入一条故意的失败断言，期望恰好 `N/N+1`。用来证明「断言真的会失败」，而不是恒真 |
| `-Clean` | 收尾删除 `%TEMP%\kb-web-admin-verify\` 下的 `edge-*` 浏览器 profile（每个 ~50MB）、DOM dump 与浏览器 stderr |
| `-Port 8801` | 换本地端口（默认 8791） |
| `-HarnessDir <dir>` | 显式指定脚本目录（默认脚本自身所在目录） |
| `-Root <dir>` | 显式指定仓库根（默认从脚本位置向上找 `docs/SCHEMA.md`） |
| `-Backend <url>` | **真后端冒烟模式**，见下 |

### 真后端冒烟（后端就绪后）

```powershell
powershell -File tools\verify\frontend-admin\verify.ps1 -Backend http://127.0.0.1:8080 -User admin -Password <密码>
```

这个模式做三件事：

1. **登录**（`/api/auth/login`；失败则尝试 `/api/auth/register` 完成空库首人注册）拿到 `KB_SESSION`
2. **只读契约探测**（`node mock.js --probe <backend> --cookie ...`）：按 `docs/API.md` 冻结形状逐个校验
   `/api/health`、`/api/auth/me`、`/api/stats`（含 `dailyCreated` 恰 14 天）、`/api/recent`、`/api/trash`
   （`folders[].noteCount` 为数字、`notes[]` 含 `title/deletedAt/folderName`）、`/api/admin/users`、
   `/api/admin/invites`（`used`/`expired`）、`/api/notes`、`/api/import/preview`（§10.1 的
   `{items,total,errors}` 与条目 `title/sourceFile/tags/folder/sizeBytes`）、`/api/export/*` 的
   `Content-Disposition: attachment`。**全部只读，不写库**（`/api/import/preview` 按契约不入库）
3. **真机渲染**：本地起一个反代（`mock.js --backend`）把真实后端的 `/api/**` 与静态资源转发给浏览器，
   并注入 `KB_SESSION`，然后逐视图加载 `#/trash`、`#/io`、`#/stats`、`#/admin`，
   断言「无 console error / 无白屏 / 无桩文本 / 无加载失败提示 / 本视图的关键 DOM 标记齐全」，
   最后打印每个视图实际请求到的真实端点

> mock 数据驱动的 100+ 交互断言在 `-Backend` 模式下**会跳过**（fixture 是 mock 数据），脚本会明确打印说明。
> 契约形状由第 2 步的只读探测覆盖。

## 覆盖范围（direct 模式）

- **trash**：两个区块渲染、`noteCount`/`folderName`（含 `null → 未分类`）、恢复/彻底删除/清空的 URL 与方法、
  二次确认措辞（不可恢复/数量）、恢复后调 `refreshTree`、列表即时刷新、空状态、清空后清空按钮禁用
- **io**：拖拽入列（含 zip 互斥与重复跳过）、总大小、`preview` multipart 提交（3 个文件）、
  确认框逐字段渲染（`title/sourceFile/folder/sizeBytes/tags`）、`total`+`errors` 摘要、
  `total===0 && errors>0` 只显示错误不弹框、导入结果 `imported/skipped/errors` 渲染、
  导出全部与单篇导出的真实 URL、导入后 `refreshTree` + 清空已选文件
- **stats**：14 根柱子（含 6 个 `count=0` 的日期，0 值仍有可见高度）、峰值 100% 归一化、
  悬停提示含日期与数量、千分位、`formatBytes` 展示附件占用、最近更新 5 条、卡片跳转
- **admin**：非管理员**零请求** + 无权提示；管理员列表渲染、自身行「停用/删除」禁用并带 tooltip、
  最后一名管理员同样禁用、创建用户 `POST` 请求体、409 字段级错误（重开表单 + 内联错误 + 保留输入 + 聚焦）、
  编辑自己时不给角色/状态字段、编辑他人的 `PATCH`（空密码不下发）、删除用户的二次确认与级联措辞、
  邀请码列表状态徽标（已用不可吊销）、生成/吊销/一键复制
- **每个视图**：`unmount` 后重挂载只发 1 次请求（无重复）；卸载后点旧 DOM 不再发请求（无监听器泄漏）
- **XSS**：`<img src=x onerror=alert(1)>` 注入服务端可控的**每一处字符串**——
  笔记标题 / 目录名 / `folderName` / 上传文件名 / `preview.title` / `preview.sourceFile` /
  `preview.folder` / `preview.tags` / 用户名 / 显示名；断言只以转义文本出现、DOM 里零个可执行 `<img>`、
  且 `window.alert` 哨兵未被触发

## 常见排查

- **`Edge not found`**：改 `dump.ps1` 里的路径，或在 PATH 上提供 `msedge.exe`
- **端口被占**：脚本会杀占用者；也可以 `-Port` 换一个
- **断言全 0 / 报告为空**：多半是 `-Backend` 模式下没有可驱动数据（预期行为），或 mock 未就绪（看第 6 步输出）
- **`docs\SCHEMA.md` not found**：把目录整体挪出了仓库；用 `-Root` 指回仓库根

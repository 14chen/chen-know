# 个人知识库 · 使用说明

一个跑在自己电脑上的个人知识库：Markdown 笔记 + 中文全文搜索 + 双向链接 + 附件 + 回收站。
支持多用户，每个用户有独立的空间，互相看不到对方的笔记。
需要时可以用 Cloudflare 临时隧道生成一个 `https://xxx.trycloudflare.com` 地址，发给别人就能在公网访问（自带 HTTPS，不用公网 IP、不用改路由器）。

---

## 一、功能一览

| # | 模块 | 说明 |
|---|------|------|
| 1 | **账号与空间隔离** | 注册/登录/登出；一个用户一个独立空间，任何查询都带空间隔离条件，看不到别人的笔记；管理员可管理用户与邀请码 |
| 2 | **笔记** | Markdown 正文；标题/正文/收藏/置顶/所属目录；每次改动自动留版本，可查看历史版本并一键回滚（回滚本身也会产生新版本） |
| 3 | **目录树** | 无限层级文件夹，可拖树形结构查看；删除文件夹会连同子孙文件夹和里面笔记一起进回收站 |
| 4 | **标签** | 自定义名称与颜色；按标签筛选笔记；同一个标签下的笔记数量统计 |
| 5 | **中文全文搜索** | 基于 SQLite FTS5 的中文检索，支持 1–2 字的中文词（「天气」「笔记」都能搜到），结果带 `<em>` 高亮 |
| 6 | **双向链接** | 正文里写 `[[某篇笔记标题]]` 即建立出链；被引用的笔记能看到反链；未创建的标题会显示为待创建 |
| 7 | **附件 · 回收站 · 统计 · 导入导出** | 图片/PDF/文本等附件上传下载（单文件 20 MB）；软删除进回收站可恢复或彻底删除；首页统计；笔记导出 `.md`/整库导出 ZIP、Markdown 批量导入 |

前端是 React 19 + TypeScript + Vite 构建的单页应用（hash 路由），构建产物由后端直接提供，浏览器打开主地址即可使用。**日常使用不需要装 Node** —— 产物已随仓库提供。

> 📖 **第一次用，先看 [`使用手册.md`](使用手册.md)** —— 那份是**图文逐步教程**（含截图，从怎么启动讲到手机上怎么用）。
> 本文档是**参考手册**：环境要求、数据位置、备份迁移、公网安全、常见问题。

---

## 二、环境要求

- **Windows 10 / 11**
- **JDK 21**（唯一需要手动安装的东西）
  - 下载：<https://adoptium.net/zh-CN/temurin/releases/?version=21>
  - 安装时请勾选 **Set JAVA_HOME variable**，装完重开命令行窗口
  - 验证：命令行执行 `java -version`，应显示 `21.x`
- **构建工具不用另装，但「首次运行会自动下载 Maven」在本仓库不成立**：`backend\mvnw.cmd` 缺少 wrapper jar（`.mvn/wrapper/maven-wrapper.jar`），官方分发地址在本机返回 404。
- **当前环境实测可用的离线构建方式**：Maven 3.10.0 已缓存在 `%USERPROFILE%\.m2\wrapper\dists\apache-maven-3.10.0\<随机目录>\bin\mvn.cmd`。先找到这个 `mvn.cmd` 的完整路径，再执行：
  ```powershell
  cd backend
  & "<上面找到的 mvn.cmd 完整路径>" -o -DskipTests package
  ```
  `-o` = **离线**。已实测 `mvn -o -q -DskipTests compile` 退出码 0；若本地仓库缺依赖，命令会报错，那时才需要联网补齐一次。

> 检验方法：双击 `scripts\start.cmd`，若提示找不到 Java，按上面的链接安装即可。

---

## 三、快速上手

### 3.1 第一次启动

1. 双击 **`scripts\start.cmd`**
2. 首次会自动构建，屏幕会提示「首次构建需要几分钟下载依赖，请耐心等待」，属于正常现象
3. 构建完成后会打印访问地址，例如：

   ```
   本机：    http://127.0.0.1:8080
   局域网：  http://192.168.1.23:8080   [WLAN]
   ```

4. 浏览器打开 `http://127.0.0.1:8080`
5. **注册第一个账号 —— 第一个注册的用户自动成为管理员**（这时不需要邀请码）
6. 之后要给别人开号：用管理员账号进入管理界面 → 生成邀请码 → 把邀请码给对方，对方注册时必须填邀请码

> 管理员还能：直接创建账号、重置密码、停用/启用账号、修改角色、吊销邀请码。
> 为避免把自己锁在门外，系统禁止管理员停用/降级/删除自己，也禁止停用最后一个管理员。

### 3.2 日常启动

双击 **`scripts\start.cmd`**，等窗口打印地址后用浏览器打开即可。
**这个窗口要保持打开**，关掉窗口服务就停止了。

### 3.3 局域网使用（同一个路由器下的手机/平板）

用启动时打印的「局域网」地址（形如 `http://192.168.x.x:8080`）访问。
如果打不开：多半是 Windows 防火墙拦了 8080 —— 首次运行时会弹出「是否允许网络访问」，请选**允许**；漏点了就到「Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙」里放行 Java。

### 3.4 公网使用（发给别人访问）

双击 **`scripts\start-public.cmd`**，等屏幕上出现醒目的绿色方框，里面就是公网地址：

```
######################################################################
#  公网地址（把这个地址发给别人，他们就能访问）：
#      https://quiet-river-1234.trycloudflare.com
######################################################################
```

把这一行地址发给别人即可，**必须保持窗口打开**，按 `Ctrl+C` 停止（应用和隧道会一起关闭）。

- **这个地址每次重启都会变**，是 Cloudflare 免费提供的临时隧道地址，不是固定域名
- 高级用法：如果本地服务已经在运行，只想补一个隧道，可以运行 `scripts\start-public.cmd -SkipApp`

---

## 四、数据、备份与迁移

### 4.1 数据存在哪里

| 路径 | 内容 |
|------|------|
| `data\kb.db` | 全部业务数据（账号、笔记、目录、标签、链接、附件记录），SQLite 单文件 |
| `data\kb.db-wal` / `data\kb.db-shm` | SQLite 的 WAL 日志文件，**属于数据库的一部分**，不要单独删除 |
| `data\uploads\` | 上传的附件原文件（按空间分目录存放） |
| `backups\kb-YYYYMMDD-HHMMSS\` | 备份产物 |
| `scripts\.runtime\` | 启动脚本的运行日志（应用日志 `app.log`、隧道日志 `tunnel.err.log`），可随时删除 |

### 4.2 备份

双击 **`scripts\backup.cmd`**，会把整个 `data\` 目录复制到 `backups\kb-年月日-时分秒\`，并打印用时、文件清单和大小。

**为什么是整目录复制？**
数据库跑在 WAL 模式，最近的提交可能还只在 `kb.db-wal` 里。**只拷 `kb.db` 一个文件有可能丢掉最后一些改动**。备份脚本把 `kb.db`、`kb.db-wal`、`kb.db-shm` 和 `uploads\` 一起拷走，SQLite 打开备份时会自动回放 WAL，得到的就是完整数据。

- 服务**没在运行**时：冷备份，数据完全一致
- 服务**正在运行**时：热备份，脚本会给出提示 —— 极端情况下（正好在写入的那一瞬间）可能少最后一笔事务。要求 100% 精确就先关掉服务再备份。

### 4.3 恢复

1. 关闭知识库（关掉启动窗口）
2. 把备份目录里的内容（`kb.db`、`kb.db-wal`、`kb.db-shm`、`uploads\`）拷回 `data\`
3. 重新运行 `scripts\start.cmd`

### 4.4 迁移到另一台电脑

1. 把整个项目目录拷过去（至少要有 `backend\`、`scripts\`、`tools\`、`data\`）
2. 目标电脑装好 JDK 21
3. 运行 `scripts\start.cmd`，首次会自动构建，数据原样可用

---

## 五、公网安全须知（重要）

1. **临时地址会变**：每次启动 `start-public.cmd` 都是一个新的 `https://xxx.trycloudflare.com`，窗口关掉即失效。想固定地址需要 Cloudflare 账号 + 自有域名（本机脚本用的是免费快速隧道，不涉及账号）。
2. **必须使用强密码**：任何人拿到这个地址都能打开登录页，密码就是唯一的门锁。建议 12 位以上，混合大小写/数字/符号，不要用姓名、生日、手机号。注意：注册密码最少 8 位，但公网场景请自觉加长。
3. **登录失败会限流**：同一个用户名连续输错 5 次密码，会被锁定 15 分钟（返回 429），期间即使密码正确也进不去。这是防止别人暴力猜密码的机制。
4. **建议先在局域网验证好再开公网**：功能确认无误、账号密码确认可靠之后，再对外发地址。
5. **会话有效期 7 天**：登录后 7 天内免登录；Cookie 是 `HttpOnly` + `SameSite=Lax`，脚本/网页无法读取。
6. **不要把地址发到公开群/论坛**：链接就是钥匙。用完之后直接关掉 `start-public.cmd` 窗口，隧道即刻失效。
7. **第一个注册的账号是管理员**：如果打算公网开放，请务必自己先在本机注册好管理员账号，再让别人注册（他们需要你发邀请码）。

---

## 六、常见问题

**Q1：提示「端口 8080 已被占用」怎么办？**
说明 8080 已经有别的程序在用（可能是上一次没关干净的知识库，也可能是别的服务 —— 8080 是很热门的端口）。脚本会提示占用它的进程名和 PID。

- **换端口（推荐，不用动别的程序）**：
  ```
  scripts\start.cmd -Port 8081
  ```
  也可以用环境变量：`set KBPORT=8081` 后再运行 `start.cmd`。换端口**不影响数据**，笔记仍在同一个 `data\kb.db`。
- 或者先访问 <http://127.0.0.1:8080> 看看是不是知识库已经开着了，是的话直接用那个窗口
- 或者打开任务管理器，结束提示的进程，再重新运行脚本（这样能继续用默认的 8080）
- 查占用：`Get-NetTCPConnection -LocalPort 8080 -State Listen`

**Q2：第一次启动很慢 / 卡在下载？**
首次运行需要下载 Maven 和全部依赖（几百 MB），视网速需要几分钟。只要窗口还在滚字就是在工作；如果报错，重跑一次通常就好（已下载的部分会复用）。

**Q3：公网地址打不开？**
- 刚生成时可能要等 5～10 秒才能生效，刷新几次
- 确认 `start-public.cmd` 的窗口还开着（关掉即失效）
- 换个网络试（部分公司网络会限制）
- 看窗口里的隧道日志或 `scripts\.runtime\tunnel.err.log`；若 cloudflared 被杀毒软件拦截，请放行

**Q4：忘记管理员密码了？**
没有自助重置。可以让另一个管理员在管理界面重置；如果只有一个管理员账号且密码丢了，只能删除 `data\kb.db` 重新开始（建议平时用 `scripts\backup.cmd` 备份）。

**Q5：能让服务跑在别的端口吗？**
当前版本固定 8080（脚本、配置文件、隧道都按 8080 写死）。改端口需要同时改 `backend\src\main\resources\application.properties` 和 `scripts\lib\kb-common.ps1`。

**Q6：关掉窗口后服务还在跑吗？**
不会。`start.cmd` / `start-public.cmd` 关闭窗口会一起结束应用进程；`start-public.cmd` 还会连带结束 cloudflared 隧道。

**Q7：代码更新了，怎么重新构建？**
`scripts\start.cmd -Rebuild`（会先删掉旧 jar 再重新打包）。

**Q8：日志在哪？**
公网模式下应用日志在 `scripts\.runtime\app.log`，隧道日志在 `scripts\.runtime\tunnel.err.log`。本机模式（`start.cmd`）日志直接显示在窗口里。

---

## 七、给维护者

**目录约定**

| 目录 | 内容 |
|---|---|
| `backend\` | Spring Boot 服务端（源码 + Maven Wrapper） |
| `frontend\` | React + TypeScript 前端源码 |
| `backend\src\main\resources\static\` | **前端构建产物**（由 `npm run build` 生成，不要手改） |
| `frontend-legacy\` | 旧零构建前端（已归档，不参与构建） |
| `scripts\` | 启动 / 备份 / 公网脚本 |
| `tools\verify\` | 验收脚本（Lead 用；不参与生产） |
| `data\` `backups\` | 数据与备份（不入库） |

**改前端后必须重新构建并重新打包**

```powershell
cd frontend
npm install          # 首次
npm run build        # 产物输出到 backend\src\main\resources\static\

cd ..\backend
.\mvnw.cmd -B -DskipTests package    # 重新打包（jar 里是打包时刻的静态资源）
```

> ⚠️ **最容易踩的坑（一）**：只跑 `npm run build` 是不够的 —— **运行中的 jar 提供的是打包时刻的资源**。
> 改完前端必须重新 `package` 并重启，否则你会以为改动没生效（我本人踩过两次）。

> ⚠️ **最容易踩的坑（二）：应用运行时会锁住 jar，构建会失败并且把 jar 弄坏。**
> Windows 上运行中的实例持有 `backend\target\knowledge-base-0.0.1-SNAPSHOT.jar`，此时执行 `package`：
> 1. `jar:jar` 先把 fat jar **覆盖成一个 ~1 MB 的普通 jar**（不可运行）
> 2. `repackage` 想把普通 jar 改名为 `.original` —— **被锁拒绝**，构建中断
> 3. 结果磁盘上留下一个**没有 `BOOT-INF/` 的假 jar**
>
> **要做两件事**：
> - 想构建就**先停掉正在运行的应用**
> - 或者换个输出名，与运行中的实例并存：
>   ```powershell
>   .\mvnw.cmd -B -DskipTests package "-Dmaven.build.finalName=kb-test"   # → target\kb-test.jar
>   ```
>   （`pom.xml` 里已写 `<finalName>${maven.build.finalName}</finalName>` 才支持这个覆盖）
>
> `scripts\lib\kb-common.ps1` 的 `Get-KbJarPath` 会**校验 jar 里有没有 `BOOT-INF/`**，遇到假 jar 会跳过并自动重新构建 —— 所以这种情况能自愈，但你会在启动时看到「发现不可运行的 jar」的提示。

**验收**

```powershell
# 后端测试：54 个测试类 / 331 个 @Test（2026-10-28 实测口径；早期文档里的 159/185/233/242 均已作废）
# 本机内存偏紧，裸 test 可能因 surefire fork 申请不到内存而崩（页面文件太小）。
# 用这条带内存上限的命令（mvn.cmd 路径见上面「环境要求」）：
cd backend
& "<缓存里的 mvn.cmd 完整路径>" -B -o test "-DargLine=-Xmx768m -Xms192m -XX:MaxMetaspaceSize=320m -XX:ReservedCodeCacheSize=48m -XX:-TieredCompilation -XX:+UseSerialGC -Xss512k"

# 端到端（先起一个隔离实例，避免碰真实数据；注意换端口，别和日常实例抢 8080）
java -jar backend\target\knowledge-base-0.0.1-SNAPSHOT.jar --server.port=8090 --kb.data-dir=%TEMP%\kb-e2e
python tools\verify\e2e-acceptance.py      http://127.0.0.1:8090 --fresh   # 103 项（--fresh 要求目标库为空，它不清库）
python tools\verify\verify_import_images_lead.py http://127.0.0.1:8090   # 19 项（导入图片 + 导出往返）
node   tools\verify\verify-proto.mjs       http://127.0.0.1:8090/         # 29 项（Typora 编辑器核心）
node   tools\verify\verify-views.mjs       http://127.0.0.1:8090/         # 13 项（11 视图内容）
node   tools\verify\verify-import-ui.mjs   http://127.0.0.1:8090/         #  8 项（导入界面）
node   tools\verify\responsive.mjs         http://127.0.0.1:8090/         # 95 项（四断点 + 触摸）
```

**契约文档**

- `docs\API.md` —— REST 接口契约（**改代码前先读**）
- `docs\SCHEMA.md` —— 数据模型与中文检索策略
- `docs\IMPORT-IMAGES.md` —— 导入图片的设计（相对路径索引、引用重写规则）
- `docs\VERIFY.md` —— 验收证据、技术债与遗留风险。⚠️ **该文件是恢复期的历史记录，里面的结论可能已过时**（测试数、启动 DDL 条数、手册截图存缺等），一律以当前代码与实测为准
- `frontend\FULL.md` —— 前端实现契约（文件所有权、视图接口、响应式规范）
- `docs\使用手册.md` —— 面向使用者的图文教程

**其它**

- `tools\cloudflared.exe` 来自 Cloudflare 官方发布页，可用 `cloudflared.exe --version` 校验
- 本机 PowerShell 是 **5.1**：含中文的 `.ps1` 必须存成 **UTF-8 with BOM**，否则按 GBK 解码会语法崩

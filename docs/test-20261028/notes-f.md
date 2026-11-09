# 流 F 进展记录（前端修复与响应式 · 端口 8536 · 数据目录 F:\work\test\kb\d-f）

## 1. DEF-E4-001（S2/P1）界面无法修改笔记标题 —— 已修
改法（4 个文件）：
- `frontend/src/shell/Topbar.tsx`：新增 NoteTitle 组件。显示态是 button（class kb-topbar__subject、aria-label=重命名笔记、title=点击修改笔记标题、带 ✎ 图标），点击切 input（data-testid=topbar-note-title-input，maxLength=512）；回车/失焦保存、Esc 取消；renameSignal 变化时外部可唤起编辑态。
- `frontend/src/shell/useNotes.ts`：新增 renameNote(id,title) → PATCH /api/notes/{id} {title}（API.md:139 已支持），成功后同步 items 与 selectedTitle；新增 FALLBACK_TITLE='未命名笔记'，空/空白标题兜底而非存空；新增 markDeleted(id)。
- `frontend/src/shell/NoteList.tsx`：笔记项「更多操作」菜单新增 重命名（菜单现为 [重命名, 删除]），MENU_HEIGHT 44→88。
- `frontend/src/shell/Sidebar.tsx` / `AppShell.tsx`：透传 onRenameNote；handleRenameNote 保存并提示（成功「标题已更新」；空标题「标题不能为空，已保存为「未命名笔记」」）；handleStartRename 先打开该篇再唤起编辑态。
- `frontend/src/styles/shell.css`：标题按钮/hover/编辑态样式（窄屏仍隐藏，改名入口走菜单）。

自证（evidence/f/f-verify-results.json，F-02~F-12 全 PASS）：改标题后顶栏+列表即时更新；GET /api/notes/{id} 的 title 已是新值；刷新后仍是新标题；搜索按新标题命中；空标题存成「未命名笔记」且有 toast；菜单 [重命名,删除] 且能唤起编辑态。

## 2. DEF-E4-004（S3）删除当前笔记后残留 2 次 404 —— 已修
改法：useNotes 增加 deletedIdsRef:Set<number> + markDeleted(id)；select() 开头 if (deletedIdsRef.current.has(id)) return（不再 getNote）；AppShell.handleDeleteNote 在 deleteNote 成功后、clear()/reload()/导航之前调用 notes.markDeleted(id)。地址栏残留的已删 id 于是不再触发请求。
自证（F-15/F-16）：删除当前笔记后，对该 id 的 REQ 与 404 RES 均为 0，console 无 404。

## 3. DEF-E4-005（S4）搜索页请求不存在的 /api/folders/tree → 405 —— 已修
改法：frontend/src/views/search/index.tsx:137 由 /api/folders/tree 改为 /api/folders?tree=true。全仓 grep 仅此一处用错。
自证（F-13/F-14）：搜索页网络只见 GET /api/folders?tree=true，无 405。

## 4. 响应式多端（375/390/768/1366/1920）
frontend/src/styles/shell.css 追加 ≤767px 块：按钮/图标按钮 min-height（图标另加 min-width）40px、.kb-tree-row__main 40px、.kb-note-item__main 44px、.kb-note-item__more 40×40；弹窗全屏化（.kb-scrim padding:0 + place-items:stretch、.kb-modal 100% 宽高/去圆角/flex 列、.kb-modal__body 可滚、footer 加 safe-area）；长文本 overflow-wrap:anywhere、笔记标题 white-space:normal。
自证（F-20~F-27，五档全 PASS）：横向溢出 0；顶栏与 .kb-editor-region 无重叠；≤390 触控 <40px 按钮 0/23；375/390/768 侧栏为抽屉且有菜单按钮，汉堡可开（sideX=0）、可关（375/390 用侧栏「收起左栏」，768 点遮罩，均回到负值）；深色主题切换正常且无溢出。

## 5. E4-003（3 字高亮，归流 A）验收结论
按 A 给的渲染口径核对：标题用 highlight（em），正文用 snippet（纯文本 + **→strong）。
实测搜「天气很」：em=0、strong=1 → 正文命中已被强调；标题 em=0 是因为该笔记标题「天气记录F」不含「天气很」（标题未命中自然无 em）。
结论：高亮已生效，界面形态为 strong（正文）/ em（标题，仅标题命中时），不是未修好。

## 6. 构建与产物
- npm run build：vite outDir 直写 backend/src/main/resources/static（构建输出可见 ../backend/src/main/resources/static/assets/index-*.js），无需手工复制。最后一次 build 产物 index-DGAx4onk.css(18:59:43)，随后 kb-build.ps1 exit=0。
- 实例：kb-run.ps1 -Port 8536 -DataDir F:\work\test\kb\d-f；每轮验证前清空数据目录，保证「首位注册即 admin」成立。

## 7. 踩到的坑（供他人复用）
1. CSS 追加位置踩雷：用“替换文件末尾 160 字符”的方式追加样式，把整段 @media 插进了未闭合的 .kb-topbar__subject--editing { 规则体内 → 浏览器按 CSS Nesting 解释成后代选择器，规则“存在但不生效”（computed min-height 仍 auto）。教训：追加前确认文件末尾是完整闭合块，或直接 append 到 EOF。
2. Start-Process + 长等待会被打断：kb-run.ps1 内含最多 60s 等健康的循环；外层命令被工具超时强杀时 JVM 随之被杀。改为 Start-Process powershell -File kb-run.ps1 立即返回，再单独轮询健康，实例才能持续存活。
3. 跨流编译竞态：18:40 起实例时应用启动失败，报 Parameter 0 of constructor in com.kb.search.SearchController required a bean of type com.kb.search.SearchService that could not be found —— 当时流 A 的 com.kb.search 处于改到一半状态。重试后正常。

## 8. 未做/放弃
- 未做弹窗窄屏全屏化的视觉回归截图对比（只验证了规则生效与无溢出）。
- 未改任何后端 Java 代码（属他人）；未动 jar、pom.xml、node_modules、docs/test-20261027。

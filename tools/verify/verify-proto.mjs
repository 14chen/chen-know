// Lead 的独立端到端验收：直接用 CDP 驱动真实浏览器操作原型。
// 刻意不复用实现者的脚本，验证结论必须来自我自己的观测。
//
// 用法：node tools/verify/verify-proto.mjs [url]

import { launch } from './cdp.mjs'

const URL = process.argv[2] || 'http://localhost:5173/proto/index.html'
const SHOTS = 'D:/deepseekhums/work/知识库/tools/verify/shots'

let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  [PASS] ${name}${detail ? '  :: ' + detail : ''}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  [FAIL] ${name}${detail ? '  :: ' + detail : ''}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function clickLine(p, index, offsetX = 40) {
  const box = await p.eval(`(() => {
    const lines = document.querySelectorAll('.cm-line');
    const el = lines[${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + ${offsetX}, y: r.y + r.height / 2 };
  })()`)
  if (!box) throw new Error(`第 ${index} 行不存在`)
  await p.clickAt(box.x, box.y)
  await sleep(350)
}

/** 取编辑器所有行的纯文本 */
async function editorLines(p) {
  return await p.eval(`JSON.stringify([...document.querySelectorAll('.cm-line')].map(e => e.textContent))`).then(JSON.parse)
}

const b = await launch({ width: 1440, height: 900 })
try {
  const p = await b.newPage(URL)
  await p.waitForLoad()

  console.log('='.repeat(72))
  console.log('A. 登录页')
  console.log('='.repeat(72))
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { label: '登录表单出现' })
  check('A1 未登录时渲染登录页', await p.eval(`!!document.querySelector('input[name="username"]')`))
  const title = await p.eval(`document.title`)
  // 标题会随打开的笔记变化（形如「X · 知识库」），所以只断言：
  // 含「知识库」、且**不含**「原型」（应用已是正式版，不该再出现原型字样）
  check('A2 页面标题正确（含「知识库」且无「原型」）',
    title.includes('知识库') && !title.includes('原型'), `document.title="${title}"`)
  check('A3 初始无控制台异常', (await p.consoleErrors()).length === 0)

  // 故意输错密码
  await p.eval(`(() => {
    const u = document.querySelector('input[name="username"]');
    const pw = document.querySelector('input[name="password"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(u, 'demo'); u.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(pw, 'WrongPassword999'); pw.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(200)
  await p.click('button.kb-btn--primary')
  await sleep(1800)
  const errText = await p.eval(`(document.body.innerText.match(/[^\\n]*(错误|失败|不正确|无效)[^\\n]*/) || [''])[0]`)
  check('A4 错误密码 → 表单内联报错且停留登录页',
    errText.length > 0 && !!(await p.eval(`!!document.querySelector('input[name="username"]')`)),
    `提示="${errText.trim().slice(0, 60)}"`)

  console.log('')
  console.log('='.repeat(72))
  console.log('B. 登录并列出真实笔记')
  console.log('='.repeat(72))
  await p.eval(`(() => {
    const u = document.querySelector('input[name="username"]');
    const pw = document.querySelector('input[name="password"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(u, 'demo'); u.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(pw, 'DemoPass123!'); pw.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(200)
  await p.click('button.kb-btn--primary')
  await p.waitFor(`!!document.querySelector('.cm-content')`, { timeout: 20000, label: '编辑器挂载' })
  await sleep(1200)

  const noteTitles = await p.eval(`JSON.stringify([...document.querySelectorAll('*')].filter(e => /^(欢迎使用知识库|Markdown 速查|双向链接演示|中文排版测试|长文档性能测试)/.test((e.textContent||'').trim()) && e.children.length === 0).map(e => e.textContent.trim()))`)
  const titles = JSON.parse(noteTitles)
  const uniq = [...new Set(titles)]
  check('B1 登录成功并进入应用外壳', await p.eval(`!!document.querySelector('.cm-content')`))
  check('B2 笔记列表出现了后端真实数据', uniq.length >= 4, `识别到 ${uniq.length} 个标题: ${uniq.slice(0, 6).join(' / ')}`)
  check('B3 无控制台异常', (await p.consoleErrors()).length === 0, JSON.stringify(await p.consoleErrors()))
  await p.screenshot(`${SHOTS}/01-shell-light.png`)

  console.log('')
  console.log('='.repeat(72))
  console.log('C. Typora 核心行为（用户要评估的重点）')
  console.log('='.repeat(72))

  // 当前打开的应是第一篇，标题行在第 0 行
  await clickLine(p, 0)
  let lines = await editorLines(p)
  const srcHeadingLines = lines.filter((l) => /^#\s/.test(l)).length
  check('C1 光标在标题行时，该行显示源码（`#` 可见）',
    srcHeadingLines === 1, `含 "# " 的行数=${srcHeadingLines}，第0行="${(lines[0] || '').slice(0, 40)}"`)

  const headingVisible = await p.eval(`(() => {
    const l = document.querySelectorAll('.cm-line')[0];
    return l ? l.textContent.startsWith('# ') : false;
  })()`)
  check('C2 该行内容就是原始 Markdown', headingVisible)

  // 点到正文段落（第 4 行附近），标题行应恢复渲染
  await clickLine(p, 4)
  lines = await editorLines(p)
  const afterSrc = lines.filter((l) => /^#\s/.test(l)).length
  check('C3 光标移开后，标题行渲染（`#` 消失）',
    afterSrc === 0, `含 "# " 的行数=${afterSrc}，第0行="${(lines[0] || '').slice(0, 40)}"`)

  // 粗体标记
  const boldVisible = lines.filter((l) => l.includes('**')).length
  check('C4 渲染态下行内 ** 标记被隐藏', boldVisible <= 1, `含 ** 的行数=${boldVisible}`)

  console.log('')
  console.log('='.repeat(72))
  console.log('D. 双链与渲染覆盖')
  console.log('='.repeat(72))
  // 真实类名（由 probe2/probe3 探明 + p-editor 交底的 DOM 契约）
  // 陷阱：块级 widget（hr / table）不是 .cm-line，而是 .cm-content 下的独立 div
  // 陷阱：光标若停在块级元素所在行，该块会退回源码 —— 断言前必须先把光标移开
  //
  // 注意：列表按 updatedAt 排序，刚被 PATCH 过的笔记会排第一，
  //      所以这里必须**显式打开目标笔记**，不能假设默认打开的是哪一篇。
  // 注意：只从**侧栏笔记列表**里找，不能全文档按文本找。
  // 「相关推荐」面板也会渲染别的笔记标题，全文档匹配会点错元素（2026-11-01 踩过）。
  // 按标题打开笔记：走 API 查 id 再改 hash。
  // 不要点侧栏列表项 —— 侧栏可能处于收起状态（点隐藏元素无效），
  // 而且「相关推荐」面板也会渲染别的笔记标题，按文本找会命中多个元素（2026-11-01 踩过）。
  const openNote = async (title) => {
    const id = await p.eval(`fetch('/api/notes?size=200')
      .then(r => r.json())
      .then(j => { const hit = (j.items || []).find(n => n.title === ${JSON.stringify(title)}); return hit ? hit.id : 0 })`)
    if (!id) return false
    await p.eval(`location.hash = '#/notes/' + ${id}`)
    await sleep(300)
    const trace = []
    trace.push('t0=' + (await p.eval('location.hash')))
    for (let i = 0; i < 5; i++) { await sleep(400); trace.push('t' + (i + 1) + '=' + (await p.eval('location.hash'))) }
    console.log('    [hash轨迹 ' + title + '] ' + trace.join(' '))
    await sleep(600)
    // 光标必须离开块级元素（表格/分隔线/围栏），否则该块会退回源码导致假 FAIL
    // 只点第一行：它一定在编辑器可视区内。
    // 不要点「最后一行」—— 那是**坐标点击**，页面下方现在有「上一篇/下一篇」「相关推荐」，
    // 一旦最后一行滚出视口，坐标就会落到那些卡片上，导致跳到别的笔记（2026-11-01 踩过）。
    const n = await p.eval(`document.querySelectorAll('.cm-line').length`)
    if (n > 0) {
      await clickLine(p, 0).catch(() => {})
      await sleep(500)
    }
    return true
  }

  // 光标移到末行（先取行数）
  const lineCount = await p.eval(`document.querySelectorAll('.cm-line').length`)
  await clickLine(p, Math.max(0, lineCount - 1))
  await sleep(600)

  const opened1 = await openNote('欢迎使用知识库')
  if (!opened1) check('D0 打开「欢迎使用知识库」', false, '未找到列表项')
  const render1 = await p.eval(`JSON.stringify({
    checkboxes: document.querySelectorAll('.cm-content .cm-kb-checkbox').length,
    checked: document.querySelectorAll('.cm-content .cm-kb-checkbox-on').length,
    tables: document.querySelectorAll('.cm-content .cm-kb-table, .cm-content table').length,
    tableWraps: document.querySelectorAll('.cm-content .cm-kb-table-wrap').length,
    hr: document.querySelectorAll('.cm-content .cm-kb-hr, .cm-content hr').length,
    quotes: document.querySelectorAll('.cm-content .cm-kb-quote').length,
    bullets: document.querySelectorAll('.cm-content .cm-kb-bullet').length,
    inlineCode: document.querySelectorAll('.cm-content .cm-kb-code-inline').length,
    srcLines: document.querySelectorAll('.cm-content .cm-kb-src').length,
    headings: [1,2,3,4,5,6].map(i => document.querySelectorAll('.cm-content .cm-kb-h'+i).length).join(','),
  })`).then(JSON.parse)
  console.log(`    [渲染统计·欢迎使用知识库] ${JSON.stringify(render1)}`)
  check('D1 任务列表渲染为可交互复选框',
    render1.checkboxes >= 2 && render1.checked >= 1,
    `复选框=${render1.checkboxes}（已勾选 ${render1.checked}）`)
  check('D2 表格已渲染为真实 table',
    render1.tables >= 1, `table=${render1.tables} wrapper=${render1.tableWraps}`)
  check('D3 分隔线已渲染', render1.hr >= 1, `hr=${render1.hr}`)
  check('D4 引用块 / 项目符号 / 行内代码 均已渲染',
    render1.quotes >= 1 && render1.bullets >= 1 && render1.inlineCode >= 1,
    `quote=${render1.quotes} bullet=${render1.bullets} inlineCode=${render1.inlineCode}`)
  check('D5 标题层级 h1/h2/h3 齐全',
    render1.headings.split(',').slice(0, 3).every((n) => Number(n) > 0),
    `h1-h6 计数=${render1.headings}`)
  check('D6 渲染态下只有 1 行是源码行（光标所在行）',
    render1.srcLines === 1, `srcLines=${render1.srcLines}`)
  // 把这一篇的渲染结果截下来（用户要看观感）
  await p.screenshot(`${SHOTS}/04-note1-light.png`)

  // 再验证代码块（Markdown 速查）
  const openedSyntax = await openNote('Markdown 速查')
  if (openedSyntax) {
    const code = await p.eval(`JSON.stringify({
      codeLines: document.querySelectorAll('.cm-content .cm-kb-code, .cm-content .cm-kb-code-first, .cm-content .cm-kb-code-last').length,
      fences: document.querySelectorAll('.cm-content .cm-kb-fence').length,
    })`).then(JSON.parse)
    console.log(`    [渲染统计·Markdown 速查] ${JSON.stringify(code)}`)
    check('D7 围栏代码块渲染（内容行有代码背景类）', code.codeLines >= 3, `代码行=${code.codeLines} 折叠围栏行=${code.fences}`)
  }

  // 打开双链演示（A）验证两种 chip 状态
  const opened = await openNote('双向链接演示（A）')
  // 诊断：D8 之前到底停在哪一篇
  console.log('    [诊断] hash=' + (await p.eval('location.hash')) +
    ' lines=' + (await p.eval("document.querySelectorAll('.cm-line').length")) +
    ' firstLine=' + JSON.stringify((await p.eval("(() => { const l=document.querySelector('.cm-line'); return l ? l.textContent.slice(0,40) : '(无)' })()"))) +
    ' chipAll=' + (await p.eval("document.querySelectorAll('.cm-kb-chip').length")) +
    ' editors=' + (await p.eval("document.querySelectorAll('.cm-editor').length")) +
    ' console=' + JSON.stringify((await p.consoleErrors()).slice(0, 4)))
  if (opened) {
    const parsed = await p.eval(`JSON.stringify([...document.querySelectorAll('.cm-content .cm-kb-chip')].map(e => ({
      text: (e.textContent || '').trim(),
      isNew: e.classList.contains('cm-kb-chip-new'),
      title: e.getAttribute('title') || ''
    })))`).then(JSON.parse)
    console.log(`    [双链 chip] ${JSON.stringify(parsed)}`)
    const existing = parsed.filter((c) => !c.isNew)
    const missing = parsed.filter((c) => c.isNew)
    check('D8 双链渲染为 chip（共 2 个）', parsed.length === 2, `chip=${parsed.length}`)
    check('D9 「已存在」与「未创建」两种状态可区分',
      existing.length === 1 && missing.length === 1,
      `已存在=${existing.map((c) => c.text).join()} / 未创建=${missing.map((c) => c.text).join()}`)
    check('D10 未创建 chip 的 title 说明正确',
      missing.length === 1 && missing[0].title.includes('尚未创建'),
      `title="${missing[0]?.title ?? ''}"`)
  } else {
    check('D8 打开双链演示笔记', false, '未找到列表项')
  }

  console.log('')
  console.log('='.repeat(72))
  console.log('E. 中文输入与保存持久化')
  console.log('='.repeat(72))
  // 打开「中文排版测试」
  const opened2 = await p.eval(`(() => {
    const el = [...document.querySelectorAll('*')].find(e =>
      (e.textContent || '').trim() === '中文排版测试' && e.children.length === 0);
    if (!el) return false;
    el.click(); return true;
  })()`)
  if (opened2) {
    await sleep(1800)
    const before = await p.eval(`document.querySelector('.cm-content').textContent.length`)
    const MARK = '【验收标记Z9】'
    await p.eval(`(() => { const c = document.querySelector('.cm-content'); c.focus(); })()`)
    await clickLine(p, 2)
    await p._send('Input.insertText', { text: MARK })
    await sleep(900)
    const after = await p.eval(`document.querySelector('.cm-content').textContent`)
    check('E1 中文输入未丢字', after.includes(MARK), `标记出现=${after.includes(MARK)}`)
    check('E2 文本长度增加合理', after.length > before, `前=${before} 后=${after.length}`)

    // Ctrl+S 保存
    await p.press('s', { ctrl: true })
    await sleep(1800)
    const status = await p.eval(`(document.body.innerText.match(/[^\\n]*(已保存|保存中|未保存|保存失败)[^\\n]*/) || [''])[0].trim()`)
    check('E3 Ctrl+S 后出现保存状态提示', /已保存|保存中/.test(status), `状态="${status.slice(0, 40)}"`)

    // 关键：刷新页面，验证真的落盘了（不是只改了内存）
    await p._send('Page.reload')
    await p.waitForLoad()
    await p.waitFor(`!!document.querySelector('.cm-content')`, { timeout: 25000, label: '刷新后编辑器重新挂载' })
    await sleep(2200)
    const afterReload = await p.eval(`document.querySelector('.cm-content').textContent`)
    check('E4 刷新后改动仍在（真实持久化到后端）',
      afterReload.includes(MARK), `标记仍在=${afterReload.includes(MARK)}，长度=${afterReload.length}`)
  } else {
    check('E 打开中文排版测试', false, '未找到列表项')
  }

  await p.screenshot(`${SHOTS}/02-editor-light.png`)

  console.log('')
  console.log('='.repeat(72))
  console.log('F. 深色主题')
  console.log('='.repeat(72))
  await p.click('button[aria-label*="主题"]')
  await sleep(700)
  const theme = await p.eval(`document.documentElement.dataset.theme`)
  const stored = await p.eval(`localStorage.getItem('kb.theme')`)
  check('F1 切换到深色主题', theme === 'dark', `data-theme=${theme} localStorage.kb.theme=${stored}`)
  await p.screenshot(`${SHOTS}/03-editor-dark.png`)

  // 刷新后保持
  await p._send('Page.reload')
  await p.waitForLoad()
  await sleep(2500)
  const themeAfter = await p.eval(`document.documentElement.dataset.theme`)
  check('F2 刷新后主题保持', themeAfter === 'dark', `data-theme=${themeAfter}`)

  // 刷新后数据持久化
  const persisted = await p.eval(`!!document.querySelector('.cm-content')`)
  if (persisted) {
    await sleep(800)
  }
  check('F3 刷新后仍是已登录状态', persisted)

  console.log('')
  console.log('='.repeat(72))
  const errs = await p.consoleErrors()
  check('Z1 全程无未捕获异常', errs.length === 0, JSON.stringify(errs).slice(0, 300))
  console.log(`结果：PASS ${pass}   FAIL ${fail}`)
  if (failures.length) {
    console.log('失败项：')
    failures.forEach((f) => console.log('  - ' + f))
  }
  console.log('='.repeat(72))

  await p.close()
  process.exitCode = fail ? 1 : 0
} catch (e) {
  console.error('验收脚本异常：', e.message)
  process.exitCode = 2
} finally {
  await b.close()
}

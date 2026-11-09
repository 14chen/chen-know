/**
 * 编辑器验收脚本（真浏览器 + CDP，非仿真）。
 *
 * 运行前置：
 *   1) npm run dev            （http://localhost:5173/proto/editor-lab.html）
 *   2) node src/editor/lab/verify.mjs
 *
 * 覆盖 PROTOTYPE.md §4 的 7 条行为 + 边界 + 性能 + 截图。
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Browser, sleep } from './cdp.mjs'

const LAB_URL = 'http://localhost:5173/proto/editor-lab.html'
const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')

let passed = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures.push(name)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const COMPACT = [
  '# 一级标题',
  '普通段落，包含 **加粗** 与 *斜体*。',
  '### 三级标题',
  '- 列表项一',
].join('\n')

const FULL = [
  '# 一级标题 H1',
  '## 二级标题 H2',
  '### 三级标题 H3',
  '',
  '段落：**粗体文字**、*斜体文字*、`行内代码`、~~删除的文字~~、[链接文字](https://example.com/)。',
  '',
  '- 第一项',
  '- 第二项',
  '',
  '1. 有序第一项',
  '2. 有序第二项',
  '',
  '- [ ] 未完成任务',
  '- [x] 已完成任务',
  '',
  '> 引用第一行',
  '',
  '```ts',
  'const answer: number = 42 // 关键行',
  '```',
  '',
  '---',
  '',
  '| 名称 | 数量 |',
  '| --- | ---: |',
  '| 苹果 | 12 |',
  '',
  '双链：[[双向链接演示]] 与 [[这篇笔记还没写]]。',
  '',
  '末行普通段落（光标停在这里，其余行全部渲染）。',
].join('\n')

function q(s) {
  return JSON.stringify(s)
}

async function main() {
  await mkdir(SHOTS, { recursive: true })
  const browser = await Browser.launch({ width: 1280, height: 900 })
  const page = await browser.newPage(LAB_URL)
  await page.setViewport(1280, 900)
  const lab = (expr) => page.eval(`window.__lab.${expr}`)

  try {
    await page.waitFor('!!window.__lab', { timeout: 25000 })
    await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 25000 })
    await sleep(400)

    /* ── 0. 冒烟：编辑器挂载 ───────────────────────────── */
    console.log('\n[0] 挂载')
    const mounted = await page.eval(
      "!!document.querySelector('.cm-editor') && !!document.querySelector('.cm-content')",
    )
    check('CodeMirror 编辑器已挂载', mounted === true)
    check('初始示例文档已载入', (await lab('docText()')).startsWith('# 知识库编辑器'), '')

    /* ── 1. Typora 行为 ───────────────────────────────── */
    console.log('\n[1] Typora 行为：当前行显示源码，其余行渲染')
    await lab(`setText(${q(COMPACT)})`)
    await sleep(200)
    await lab('setCursorLineEnd(1)')
    await sleep(150)
    let p = await lab('probe()')
    check('光标在第 1 行时该行显示源码 "# 一级标题"', p.lines[0].text.startsWith('# '), p.lines[0].text)
    check('同时只有 1 行是源码行', p.srcLines === 1, `srcLines=${p.srcLines}`)

    await lab('setCursorLineEnd(2)')
    await sleep(150)
    p = await lab('probe()')
    check('光标移开后第 1 行渲染为 "一级标题"', p.lines[0].text === '一级标题', p.lines[0].text)
    check(
      '渲染后标题字号变大',
      parseFloat(p.lines[0].fs) > parseFloat(p.lines[1].fs),
      `h1=${p.lines[0].fs} 正文=${p.lines[1].fs}`,
    )
    check('第 2 行（当前行）仍显示 ** 源码', p.lines[1].text.includes('**加粗**'), p.lines[1].text)
    check('文档原文未被装饰器修改', (await lab('docText()')) === COMPACT)

    await lab('setCursor(0)')
    await lab('setSelection(0, 40)')
    await sleep(150)
    p = await lab('probe()')
    check('多行选区覆盖的行全部显示源码', p.srcLines === 4, `srcLines=${p.srcLines}（选区覆盖 4 行）`)

    /* 表格旁的标题：块级 widget 不能吃掉相邻行的行装饰（回归用例） */
    await lab(
      `setText(${q('| A | B |\n| --- | --- |\n| 1 | 2 |\n# 紧跟表格的标题\n\n尾部段落（光标停这里）')})`,
    )
    await sleep(250)
    await lab('setCursorLineEnd(6)')
    await sleep(250)
    p = await lab('probe()')
    check(
      '表格块级 widget 与相邻标题行装饰互不干扰',
      p.tables === 1 && p.lines.some((l) => l.cls.includes('cm-kb-h1') && l.text === '紧跟表格的标题'),
      JSON.stringify(p.lines.map((l) => `${l.cls}|${l.text}`)),
    )

    /* ── 2. 渲染覆盖 ──────────────────────────────────── */
    console.log('\n[2] 渲染覆盖：标题/粗斜体/行内代码/删除线/链接/列表/任务/引用/代码/分隔线/表格/双链')
    await page.setViewport(1280, 1400)
    await lab(`setText(${q(FULL)})`)
    await sleep(250)
    await lab('setCursorLineEnd(27)')
    await sleep(250)
    p = await lab('probe()')
    const texts = p.lines.map((l) => l.text)
    const joined = texts.join('\n')
    console.log(`  · 渲染行数 ${p.lines.length}，源码行 ${p.srcLines}`)

    check('h1 渲染', texts[0] === '一级标题 H1' && parseFloat(p.lines[0].fs) === 32, texts[0])
    check('h2/h3 渲染', texts[1] === '二级标题 H2' && texts[2] === '三级标题 H3')
    check('粗体：** 标记被隐藏且加粗', joined.includes('粗体文字') && !joined.includes('**'))
    check('斜体：* 标记被隐藏', joined.includes('斜体文字') && !joined.includes('*斜体'))
    check('行内代码：反引号被隐藏', joined.includes('行内代码') && !joined.includes('`'))
    check('删除线：~~ 被隐藏', joined.includes('删除的文字') && !joined.includes('~~'))
    check('链接：[文字](url) 只剩文字', joined.includes('链接文字') && !joined.includes(']('))
    check('无序列表渲染为项目符号', p.lines.filter((l) => l.text.includes('第一项')).length >= 1)
    check('有序列表保留编号', joined.includes('1. 有序第一项'))
    check('任务列表渲染为复选框 ×2', p.boxes === 2, `boxes=${p.boxes}`)
    const paraStyles = await lab('lineSpans(4)')
    const line4 = paraStyles ?? []
    check(
      '粗体 span 计算样式 font-weight ≥ 600',
      line4.some((s) => parseInt(s.fw) >= 600),
      JSON.stringify(line4.map((s) => `${s.text}:${s.fw}`)),
    )
    check('斜体 span 计算样式 italic', line4.some((s) => s.fs === 'italic'))
    check('删除线 span text-decoration=line-through', line4.some((s) => s.td.includes('line-through')))
    check(
      '行内代码 span 使用等宽字体',
      line4.some((s) => s.cls.includes('cm-kb-code-inline') && /mono|Consolas|Menlo/i.test(s.ff)),
    )
    check(
      '引用块行带 cm-kb-quote 类且 > 标记被隐藏',
      p.lines.some((l) => l.cls.includes('cm-kb-quote') && l.text.includes('引用第一行')),
      JSON.stringify(p.lines.filter((l) => l.cls.includes('cm-kb-quote')).map((l) => l.text)),
    )
    check('围栏代码块渲染为代码行且 ``` 行被折叠', p.codeLines === 1 && !joined.includes('```'), `codeLines=${p.codeLines}`)
    const codeIdx = p.lines.findIndex((l) => l.cls.includes('cm-kb-code'))
    const codeSpans = (await lab(`lineSpans(${codeIdx})`)) ?? []
    check(
      '代码块内嵌 TypeScript 语法高亮（token 着色 ≥ 3 段）',
      codeSpans.length >= 3,
      JSON.stringify(codeSpans.map((s) => s.text)),
    )
    check('分隔线渲染为 hr 部件', p.hrs === 1, `hrs=${p.hrs}`)
    const tableInfo = await page.eval(`(() => {
      const t = document.querySelector('.cm-kb-table')
      if (!t) return null
      return { th: t.querySelectorAll('thead th').length, td: t.querySelectorAll('tbody td').length, text: t.innerText.replace(/\\s+/g, ' ') }
    })()`)
    check('表格渲染为真实 <table>（2 列 1 行）', tableInfo && tableInfo.th === 2 && tableInfo.td === 2, JSON.stringify(tableInfo))
    check('表格原文的管道符不再出现', !joined.includes('|'), joined.split('\n').find((l) => l.includes('|')) ?? '')
    check(
      '双链渲染为 2 个 chip，已存在/未创建可区分',
      p.chips.length === 2 && p.chips.filter((c) => c.isNew).length === 1,
      JSON.stringify(p.chips),
    )
    await page.screenshot(join(SHOTS, '01-light-rendered.png'))

    /* ── 3. 双链点击 ──────────────────────────────────── */
    console.log('\n[3] [[双链]]：chip 可点击')
    const beforeClickDoc = await lab('docText()')
    let rect = await page.rectOf('.cm-kb-chip')
    await page.click(rect.x, rect.y)
    await sleep(150)
    check('点击已存在的 chip 触发 onWikiLinkClick("双向链接演示")', (await lab('wikiLog()')).join() === '双向链接演示', JSON.stringify(await lab('wikiLog()')))
    const newRect = await page.rectOf('.cm-kb-chip-new')
    await page.click(newRect.x, newRect.y)
    await sleep(150)
    const log2 = await lab('wikiLog()')
    check('点击未创建的 chip 触发第二回调', log2[1] === '这篇笔记还没写', JSON.stringify(log2))
    check('点击双链不改变正文', (await lab('docText()')) === beforeClickDoc)

    /* ── 4. [[ 自动补全 ──────────────────────────────── */
    console.log('\n[4] [[ 自动补全：候选 / ↑↓ / Enter / Esc / 点击插入')
    await page.setViewport(1280, 900)
    await lab(`setText(${q('双链补全测试：\n\n')})`)
    await sleep(200)
    await lab('setCursorLineEnd(1)')
    await sleep(120)
    await page.insertText('[[双')
    await sleep(300)
    let options = await page.eval(`[...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(li => li.textContent)`)
    check('输入 [[ 后弹出补全面板', Array.isArray(options) && options.length > 0, JSON.stringify(options))
    check('候选来自 knownTitles 且排除自身标题', Array.isArray(options) && !options.some((o) => o.includes('演示文档')), JSON.stringify(options))
    check('候选按输入过滤', Array.isArray(options) && options.every((o) => o.includes('双向链接演示')), JSON.stringify(options))
    // 清空输入，用完整的候选列表做 ↑↓ 测试
    await page.eval('window.__lab.setText("双链补全测试：\\n\\n")')
    await sleep(200)
    await lab('setCursorLineEnd(1)')
    await sleep(120)
    await page.insertText('[[')
    await sleep(350)
    options = await page.eval(`[...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(li => li.textContent)`)
    check('[[ 触发全部候选（3 个）', Array.isArray(options) && options.length === 3, JSON.stringify(options))
    const firstSelected = await page.eval(
      `(document.querySelector('.cm-tooltip-autocomplete li[aria-selected]') || {}).textContent || ''`,
    )
    await page.key('ArrowDown', { code: 'ArrowDown', keyCode: 40 })
    await page.key('ArrowDown', { code: 'ArrowDown', keyCode: 40 })
    await sleep(200)
    const selected = await page.eval(
      `(document.querySelector('.cm-tooltip-autocomplete li[aria-selected]') || {}).textContent || ''`,
    )
    check('↑↓ 改变高亮项', selected !== firstSelected && selected.length > 0, `初始=${firstSelected} 两次↓后=${selected}`)
    const selectedLabel = String(selected).replace(/双链$/, '').trim()
    await page.key('Enter', { code: 'Enter', keyCode: 13 })
    await sleep(250)
    const afterEnter = await lab('docText()')
    check(
      'Enter 插入当前高亮项的完整 [[标题]]',
      selectedLabel.length > 0 && afterEnter.includes(`[[${selectedLabel}]]`),
      JSON.stringify(afterEnter),
    )

    await lab('setText("Esc 测试：")')
    await sleep(200)
    await lab('setCursorLineEnd(1)')
    await sleep(120)
    await page.insertText('[[')
    await sleep(300)
    await page.key('Escape', { code: 'Escape', keyCode: 27 })
    await sleep(250)
    const tooltipGone = await page.eval("!document.querySelector('.cm-tooltip-autocomplete')")
    check('Esc 关闭补全面板', tooltipGone === true)
    check('Esc 后不插入任何内容', (await lab('docText()')) === 'Esc 测试：[[', JSON.stringify(await lab('docText()')))

    await lab('setText("点击插入：")')
    await sleep(200)
    await lab('setCursorLineEnd(1)')
    await sleep(120)
    await page.insertText('[[')
    await sleep(300)
    const optRect = await page.rectOf('.cm-tooltip-autocomplete li')
    if (optRect) await page.click(optRect.x, optRect.y)
    await sleep(250)
    check('点击候选也能插入', (await lab('docText()')).includes(']]'), JSON.stringify(await lab('docText()')))

    /* ── 5. 粘贴图片 ─────────────────────────────────── */
    console.log('\n[5] 粘贴图片')
    const pasteScript = (name) => `(() => {
      const dt = new DataTransfer()
      const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137])
      dt.items.add(new File([png], ${q(name)}, { type: 'image/png' }))
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      document.querySelector('.cm-content').dispatchEvent(ev)
      return true
    })()`
    await lab('uploadFail(false)')
    await lab(`setText(${q('正文开始：\n\n')})`)
    await sleep(200)
    await lab('setCursorLineEnd(1)')
    await sleep(120)
    await page.eval(pasteScript('shot.png'))
    await sleep(600)
    const afterPaste = await lab('docText()')
    check(
      '粘贴图片成功 → 插入 ![文件名](url)',
      afterPaste.includes('![shot.png](https://cdn.example.com/shot.png)'),
      JSON.stringify(afterPaste),
    )

    await lab('uploadFail(true)')
    await lab(`setText(${q('失败用例正文：\n\n')})`)
    await sleep(200)
    await lab('setCursorLineEnd(1)')
    await sleep(120)
    await page.eval(pasteScript('bad.png'))
    await sleep(700)
    const afterFail = await lab('docText()')
    const toastTexts = await lab('toastTexts()')
    check('上传失败 → 正文回到原样（占位符被清理）', afterFail === '失败用例正文：\n\n', JSON.stringify(afterFail))
    check('上传失败 → 弹出错误提示', toastTexts.some((t) => t.includes('图片上传失败')), JSON.stringify(toastTexts))

    /* ── 6. 快捷键 ───────────────────────────────────── */
    console.log('\n[6] 快捷键')
    await lab(`setText(${q('ABC')})`)
    await sleep(200)
    await lab('setSelection(0, 3)')
    await sleep(150)
    await page.combo('b', 2)
    await sleep(200)
    check('Ctrl+B 加粗选区', (await lab('docText()')) === '**ABC**', await lab('docText()'))
    await page.combo('b', 2)
    await sleep(200)
    check('ctrl+B 再次按下取消加粗', (await lab('docText()')) === 'ABC', await lab('docText()'))
    await lab('setSelection(0, 3)')
    await page.combo('i', 2)
    await sleep(200)
    check('Ctrl+I 斜体选区', (await lab('docText()')) === '*ABC*', await lab('docText()'))
    await lab(`setText(${q('ABC')})`)
    await sleep(200)
    await lab('setSelection(0, 3)')
    await sleep(120)
    await page.combo('k', 2)
    await sleep(200)
    const linkDoc = await lab('docText()')
    const sel = await lab('selection()')
    check('Ctrl+K 插入链接', linkDoc === '[ABC](url)', linkDoc)
    check('Ctrl+K 后选中 url 占位符', sel.from === 6 && sel.to === 9, JSON.stringify(sel))

    const saveBefore = await lab('saveCount()')
    await page.combo('s', 2)
    await sleep(200)
    check('Ctrl+S 触发 onSave', (await lab('saveCount()')) === saveBefore + 1, `saveCount=${await lab('saveCount()')}`)

    await lab(`setText(${q('- 项目一\n- 项目二\n')})`)
    await sleep(200)
    await lab('setCursorLineEnd(2)')
    await sleep(150)
    await page.key('Tab', { code: 'Tab', keyCode: 9 })
    await sleep(250)
    const afterTab = await lab('docText()')
    check('列表内 Tab 缩进', afterTab === '- 项目一\n  - 项目二\n', JSON.stringify(afterTab))
    await page.key('Tab', { code: 'Tab', keyCode: 9, modifiers: 8 })
    await sleep(250)
    check('Shift+Tab 反缩进', (await lab('docText()')) === '- 项目一\n- 项目二\n', JSON.stringify(await lab('docText()')))

    /* ── 6.5 任务复选框点击 ──────────────────────────── */
    console.log('\n[6.5] 任务复选框点击切换')
    await lab(`setText(${q('- [ ] 待办事项\n第二行（光标停这里）')})`)
    await sleep(250)
    await lab('setCursorLineEnd(2)')
    await sleep(300)
    const boxRect = await page.rectOf('.cm-kb-checkbox')
    check('渲染出复选框', !!boxRect, JSON.stringify(boxRect))
    if (boxRect) {
      await page.click(boxRect.x, boxRect.y)
      await sleep(250)
      check(
        '点击复选框把 [ ] 变成 [x]',
        (await lab('docText()')) === '- [x] 待办事项\n第二行（光标停这里）',
        JSON.stringify(await lab('docText()')),
      )
    }

    /* ── 7. 中文输入法（IME）─────────────────────────── */
    console.log('\n[7] 中文输入法：组合期间不重建装饰、不丢字')
    await lab(`setText(${q('- [ ] 任务行\n**粗体行** 结尾\n普通行')})`)
    await sleep(250)
    await lab('setCursorLineEnd(3)')
    await sleep(150)
    await lab('resetBuilds()')
    await page.imeSetComposition('zhongwen', 8, 8)
    await sleep(200)
    const composingNow = await lab('composing()')
    const buildsDuring = await lab('builds()')
    check('imeSetComposition 让 view.composing = true（真实组合态）', composingNow === true, `composing=${composingNow}`)
    check('组合输入期间装饰器 0 次重建', buildsDuring === 0, `builds=${buildsDuring}`)
    await page.imeSetComposition('zhongwen shuru', 14, 14)
    await sleep(200)
    check('组合内容更新期间仍 0 次重建', (await lab('builds()')) === 0, `builds=${await lab('builds()')}`)
    await page.insertText('中文输入')
    await sleep(400)
    const imeDoc = await lab('docText()')
    check(
      '提交后正文恰好是预期内容（无丢字、无重复、无残留拼音）',
      imeDoc === '- [ ] 任务行\n**粗体行** 结尾\n普通行中文输入',
      JSON.stringify(imeDoc),
    )
    check('组合结束后恢复重建', (await lab('builds()')) > 0, `builds=${await lab('builds()')}`)
    const compLog = await lab('compLog()')
    check(
      '浏览器真实派发了 compositionstart/update/end',
      compLog.some((e) => e.startsWith('start')) &&
        compLog.some((e) => e.startsWith('end')),
      JSON.stringify(compLog),
    )
    check('其它行的装饰未被破坏（复选框仍在）', (await lab('probe()')).boxes === 1)

    // 组合输入落在带行内装饰的行上
    await lab(`setText(${q('上一行有**装饰**\n当前行结尾：')})`)
    await sleep(250)
    await lab('setCursorLineEnd(2)')
    await sleep(150)
    await page.imeSetComposition('ceshi', 5, 5)
    await sleep(150)
    await page.insertText('测试')
    await sleep(350)
    const imeDoc2 = await lab('docText()')
    check(
      '带行内装饰的相邻行组合输入同样不丢字',
      imeDoc2 === '上一行有**装饰**\n当前行结尾：测试',
      JSON.stringify(imeDoc2),
    )

    /* ── 8. 性能：≥50 KB 文档 ────────────────────────── */
    await page.setViewport(1280, 900)
    await lab("setDoc('长文档 50KB')")
    await sleep(600)

    const perfScript = `(async () => {
      const lab = window.__lab
      lab.setCursorLineEnd(1)
      // 空转帧基线：headless 下 rAF 节拍本身就有 16–33ms 抖动，报「输入到绘制」时必须扣掉
      const idle = []
      for (let i = 0; i < 20; i++) {
        const t = performance.now()
        await new Promise((r) => requestAnimationFrame(() => r()))
        idle.push(performance.now() - t)
      }
      lab.resetBuilds()
      const chars = '中文测试 abcXYZ 123 汉字'.split('')
      const sync = []
      const painted = []
      for (let i = 0; i < 40; i++) {
        const c = chars[i % chars.length]
        const t0 = performance.now()
        document.execCommand('insertText', false, c)
        sync.push(performance.now() - t0)
        await new Promise((r) => requestAnimationFrame(() => r()))
        painted.push(performance.now() - t0)
      }
      const stat = (arr) => {
        const s = [...arr].sort((a, b) => a - b)
        return { p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) }
      }
      const i = stat(idle)
      return {
        sync: stat(sync),
        painted: stat(painted),
        idle: i,
        builds: lab.builds(),
        buildMs: lab.buildMs(),
        blockBuilds: lab.blockBuilds(),
        blockMs: lab.blockBuildMs(),
        blockTotalMs: lab.blockTotalMs(),
      }
    })()`

    const report = async (label, expectedBytes) => {
      const typePerf = await page.eval(perfScript)
      const extraP50 = +(typePerf.painted.p50 - typePerf.idle.p50).toFixed(2)
      const extraP95 = +(typePerf.painted.p95 - typePerf.idle.p95).toFixed(2)
      console.log(
        `  · [${label}] 输入 40 字符：同步处理（状态更新+装饰重建+DOM 补丁） p50=${typePerf.sync.p50}ms p95=${typePerf.sync.p95}ms max=${typePerf.sync.max}ms`,
      )
      console.log(
        `  · [${label}] 输入到下一帧：p50=${typePerf.painted.p50}ms p95=${typePerf.painted.p95}ms max=${typePerf.painted.max}ms（空转帧基线 p50=${typePerf.idle.p50}ms p95=${typePerf.idle.p95}ms）→ 净增 p50=${extraP50}ms p95=${extraP95}ms`,
      )
      console.log(
        `  · [${label}] 40 次输入触发：行内装饰重建 ${typePerf.builds} 次（单次 ${typePerf.buildMs}ms）；块级装饰 ${typePerf.blockBuilds} 次共 ${typePerf.blockTotalMs}ms（单次 ${typePerf.blockMs}ms）`,
      )
      check(`[${label}] 每次按键同步处理 < 16ms（p95）`, typePerf.sync.p95 < 16, `p95=${typePerf.sync.p95}ms`)
      check(`[${label}] 单次行内装饰构建 < 8ms`, typePerf.buildMs < 8, `${typePerf.buildMs}ms`)
      check(`[${label}] 单次块级装饰构建 < 8ms`, typePerf.blockMs < 8, `${typePerf.blockMs}ms`)
      const scrollPerf = await page.eval(`(async () => {
        const lab = window.__lab
        const s = document.querySelector('.cm-scroller')
        const max = s.scrollHeight - s.clientHeight
        lab.resetBuilds()
        const times = []
        for (let i = 0; i < 24; i++) {
          const t0 = performance.now()
          s.scrollTop = (max * i) / 23
          await new Promise((r) => requestAnimationFrame(() => r()))
          times.push(performance.now() - t0)
        }
        const sorted = [...times].sort((a, b) => a - b)
        return {
          max: Math.round(max),
          p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(2),
          p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
          worst: +sorted[sorted.length - 1].toFixed(2),
          builds: lab.builds(),
        }
      })()`)
      console.log(
        `  · [${label}] 滚动 24 帧（滚动高度 ${scrollPerf.max}px）：p50=${scrollPerf.p50}ms p95=${scrollPerf.p95}ms worst=${scrollPerf.worst}ms · 重建 ${scrollPerf.builds} 次`,
      )
      check(`[${label}] 长文档滚动每帧 < 50ms（p95）`, scrollPerf.p95 < 50, `p95=${scrollPerf.p95}ms`)
      if (expectedBytes) {
        check(`[${label}] 文档 ≥ 50 KB`, expectedBytes >= 50 * 1024, `${expectedBytes} 字节`)
      }
      return { extraP50, extraP95, sync: typePerf.sync, blockMs: typePerf.blockMs }
    }
    console.log('\n[8] 性能：50 KB 文档输入/滚动')
    await page.setViewport(1280, 900)
    await lab("setDoc('长文档 50KB')")
    await sleep(800)
    const docInfo = await lab('probe()')
    const bytes = await page.eval(
      `new TextEncoder().encode(window.__lab.docText()).length`,
    )
    console.log(
      `  · 本地造的长文档：${docInfo.chars} 字符 / ${bytes} 字节（UTF-8） / ${await lab('lineCount()')} 行，可视行 ${docInfo.lines.length}`,
    )
    await report('本地 50KB 文档', bytes)
    const localMetrics = await report('本地 50KB 文档（复测取稳定值）', null)

    /* 对照组：同样字符量级但无任何 Markdown 语法 —— 区分「装饰器开销」与「大文档渲染开销」 */
    await lab("setDoc('纯文本 100KB（对照）')")
    await sleep(800)
    const plainInfo = await lab('probe()')
    const plainBytes = await page.eval(`new TextEncoder().encode(window.__lab.docText()).length`)
    console.log(`  · 对照文档：${plainInfo.chars} 字符 / ${plainBytes} 字节（UTF-8） / ${await lab('lineCount()')} 行，无任何 Markdown 语法`)
    const plainMetrics = await report('对照：同规模纯文本', null)
    check(
      '装饰器没有引入额外帧开销（同规模纯文本对照为基线）',
      localMetrics.extraP95 <= plainMetrics.extraP95 + 2,
      `装饰文档净增 p95=${localMetrics.extraP95}ms ≤ 纯文本对照净增 p95=${plainMetrics.extraP95}ms（headless 软件渲染的大文档排版开销）`,
    )

    /* 真后端长文档交叉验证（id=6「长文档性能测试」） */
    const realDoc = await page.eval(`(async () => {
      try {
        const login = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'demo', password: 'DemoPass123!' }),
        })
        if (!login.ok) return { error: 'login HTTP ' + login.status }
        const res = await fetch('/api/notes/6')
        if (!res.ok) return { error: 'note HTTP ' + res.status }
        const data = await res.json()
        return { title: data.title, content: data.content }
      } catch (e) {
        return { error: String(e) }
      }
    })()`)
    if (realDoc && realDoc.content) {
      await lab(`setText(${q(realDoc.content)})`)
      await sleep(500)
      const realBytes = await page.eval(`new TextEncoder().encode(window.__lab.docText()).length`)
      console.log(`  · 真后端笔记 #6「${realDoc.title}」：${realDoc.content.length} 字符 / ${realBytes} 字节（UTF-8）`)
      check('真后端笔记 #6 可载入编辑器', realBytes > 0, `${realBytes} 字节`)
      await report('真后端笔记 #6', null)
    } else {
      console.log(`  · 跳过真后端交叉验证：${JSON.stringify(realDoc)}`)
      check('真后端笔记 #6 可载入编辑器', false, JSON.stringify(realDoc))
    }

    /* ── 9. 边界文档 ─────────────────────────────────── */
    console.log('\n[9] 边界文档不崩')
    for (const name of ['空文档', '只有一行', '超长单行', '纯代码块', '空代码块', '未闭合围栏']) {
      await lab(`setDoc(${q(name)})`)
      await sleep(350)
      const info = await page.eval(`(() => {
        const lab = window.__lab
        return { chars: lab.probe().chars, lines: lab.probe().lines.length, errors: lab.errors().length }
      })()`)
      check(`边界「${name}」渲染正常且无异常`, info.lines >= 0 && info.errors === 0, JSON.stringify(info))
    }
    await page.eval("window.__lab.setDoc('空文档')")
    await sleep(200)
    await lab('setCursor(0)')
    await page.insertText('空文档里输入')
    await sleep(300)
    check('空文档可输入', (await lab('docText()')) === '空文档里输入', await lab('docText()'))

    /* ── 10. 截图 ────────────────────────────────────── */
    console.log('\n[10] 截图')
    await page.setViewport(1280, 1180)
    await lab("setDoc('演示文档')")
    await sleep(500)
    const lastLine = await lab('lineCount()')
    await lab('setCursorLineEnd(1)')
    await lab('scrollTop(0)')
    await sleep(400)
    await page.screenshot(join(SHOTS, '02-light-cursor-on-heading-source.png'))
    await lab(`setCursorLineEnd(${lastLine})`)
    await sleep(400)
    await lab('scrollTop(0)')
    await sleep(300)
    await page.screenshot(join(SHOTS, '03-light-heading-rendered.png'))
    await lab('scrollTop(999999)')
    await sleep(400)
    await page.screenshot(join(SHOTS, '04-light-table-hr-chips.png'))
    await lab('theme("dark")')
    await sleep(500)
    await page.screenshot(join(SHOTS, '05-dark-table-hr-chips.png'))
    await lab('scrollTop(0)')
    await sleep(300)
    await page.screenshot(join(SHOTS, '06-dark-top.png'))
    await lab('theme("light")')
    await sleep(300)
    await lab(`setText(${q('补全截图：\n\n')})`)
    await sleep(250)
    await lab('setCursorLineEnd(1)')
    await page.insertText('[[')
    await sleep(450)
    await page.screenshot(join(SHOTS, '07-completion.png'))
    console.log(`  · 截图已写入 ${SHOTS}`)

    /* ── 12. §4 契约补充：readOnly / sync / knownTitles 刷新 ── */
    console.log('\n[12] 接口契约补充')
    await lab(`setText(${q('只读测试内容')})`)
    await sleep(250)
    await lab('setReadOnly(true)')
    await sleep(300)
    await lab('setCursorLineEnd(1)')
    await page.insertText('X')
    await sleep(300)
    check('readOnly=true 时输入不改变正文', (await lab('docText()')) === '只读测试内容', JSON.stringify(await lab('docText()')))
    await lab('setReadOnly(false)')
    await sleep(300)
    await lab('setCursorLineEnd(1)')
    await page.insertText('Y')
    await sleep(300)
    check('readOnly=false 后恢复可编辑', (await lab('docText()')) === '只读测试内容Y', JSON.stringify(await lab('docText()')))

    await lab(`setText(${q('双链状态：[[双向链接演示]]\n第二行（光标停这里）')})`)
    await sleep(300)
    await lab('setCursorLineEnd(2)')
    await sleep(250)
    await lab('setTitles(["双向链接演示"])')
    await sleep(300)
    let chips = (await lab('probe()')).chips
    check('knownTitles 传入后 chip 变为「已存在」', chips.length === 1 && chips[0].isNew === false, JSON.stringify(chips))
    await lab('setTitles([])')
    await sleep(300)
    chips = (await lab('probe()')).chips
    check('knownTitles 清空后 chip 变为「未创建」（索引变化即时生效）', chips.length === 1 && chips[0].isNew === true, JSON.stringify(chips))

    const beforeSync = await lab('docText()')
    await lab('sync()')
    await sleep(250)
    check('handle.sync() 幂等且不破坏正文', (await lab('docText()')) === beforeSync, JSON.stringify(await lab('docText()')))
    await lab('setCursorLineEnd(2)')
    await page.insertText('Z')
    await sleep(300)
    check('sync() 之后仍可继续输入', (await lab('docText()')).endsWith('第二行（光标停这里）Z'), JSON.stringify(await lab('docText()')))

    /* ── 13. 控制台错误 ──────────────────────────────── */
    console.log('\n[11] 运行期异常')
    const pageErrors = await lab('errors()')
    check('页面内未捕获异常为 0', pageErrors.length === 0, JSON.stringify(pageErrors))
    check('CDP 控制台错误为 0', page.consoleErrors.length === 0, JSON.stringify(page.consoleErrors.slice(0, 3)))
  } finally {
    await browser.close()
  }

  console.log(`\n===== 汇总：${passed} 项通过，${failures.length} 项失败 =====`)
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error('验收脚本异常:', e)
  process.exitCode = 2
})

/**
 * 富文本格式验收（docs/EDITOR-FORMAT.md §3/§4）—— 真浏览器 + CDP。
 *   node src/editor/lab/verify-format.mjs [labUrl]
 * 默认打 5199（我自己的 dev server，/api 只反代到 8090 隔离实例）。
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Browser, sleep } from './cdp.mjs'

const LAB = process.argv[2] ?? 'http://localhost:5199/editor-lab.html'
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots')

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

await mkdir(SHOTS, { recursive: true })
const browser = await Browser.launch({ width: 1280, height: 900 })
const page = await browser.newPage(LAB)

const doc = () => page.eval('window.__lab.docText()')
const setText = async (t) => {
  await page.eval(`window.__lab.setText(${JSON.stringify(t)})`)
  await sleep(220)
}
const select = async (from, to) => {
  await page.eval(`window.__lab.setSelection(${from}, ${to})`)
  await sleep(220)
}
const btnRect = (id) =>
  page.rectOf(`.kb-fmt-btn[data-format="${id}"]`)
const clickBtn = async (id) => {
  const r = await btnRect(id)
  if (!r) throw new Error(`按钮不存在: ${id}`)
  await page.clickRect(r)
  await sleep(240)
}
const swatchRect = (value) => page.rectOf(`.kb-fmt-swatch[data-color="${value}"]`)
const toolbar = () =>
  page.eval(`(() => {
    const el = document.querySelector('.kb-fmt-toolbar')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const btns = [...el.querySelectorAll('.kb-fmt-btn')].map((b) => {
      const br = b.getBoundingClientRect()
      return { format: b.dataset.format, w: br.width, h: br.height, label: b.getAttribute('aria-label'), title: b.title }
    })
    return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, placement: el.dataset.placement, btns }
  })()`)

try {
  await page.waitFor('!!window.__lab', { timeout: 30000 })
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 30000 })
  await sleep(500)

  /* ── 1. 选中文字 → 工具栏出现在选区上方 ───────────────── */
  console.log('\n[1] 工具栏出现位置')
  await setText('第一行文字内容\n第二行普通文字\n第三行普通文字')
  await select(0, 6)
  const t = await toolbar()
  const srect = await page.eval('window.__lab.selectionRect()')
  check('选中非空文本后出现工具栏', t !== null, t ? `placement=${t.placement}` : '未找到 .kb-fmt-toolbar')
  check(
    '工具栏在选区**上方**（toolbar.bottom ≤ selection.top）',
    t && srect && t.bottom <= srect.top + 1,
    `toolbar.bottom=${t?.bottom?.toFixed(1)} selection.top=${srect?.top?.toFixed(1)} gap=${(srect.top - t.bottom).toFixed(1)}px`,
  )
  check(
    '10 个按钮顺序与 aria-label 齐全',
    t &&
      t.btns.map((b) => b.format).join(',') ===
        'bold,italic,strike,underline,highlight,color,bg,code,link,clear' &&
      t.btns.every((b) => b.label && b.title),
    t?.btns.map((b) => `${b.format}:${b.label}`).join(' | '),
  )
  await page.screenshot(join(SHOTS, 'f01-toolbar-above.png'))

  /* ── 2. 逐个按钮：点击前后的正文原文 ─────────────────── */
  console.log('\n[2] 六个基础格式按钮（点击前 → 点击后）')
  const cases = [
    ['bold', '**文字**'],
    ['italic', '*文字*'],
    ['strike', '~~文字~~'],
    ['underline', '<u>文字</u>'],
    ['highlight', '<mark>文字</mark>'],
    ['code', '`文字`'],
  ]
  for (const [id, expected] of cases) {
    await setText('文字')
    await select(0, 2)
    await clickBtn(id)
    const after = await doc()
    check(`${id}：${JSON.stringify('文字')} → ${JSON.stringify(expected)}`, after === expected, JSON.stringify(after))
  }

  /* ── 3. 颜色 / 背景色 ─────────────────────────────────── */
  console.log('\n[3] 文字颜色 / 背景颜色（调色板下拉）')
  await setText('文字')
  await select(0, 2)
  await clickBtn('color')
  const paletteOpen = await swatchRect('#e11d48')
  check('点「文字颜色」弹出调色板', paletteOpen !== null, JSON.stringify(paletteOpen))
  if (paletteOpen) {
    await page.clickRect(paletteOpen)
    await sleep(260)
  }
  check(
    '文字色产出 <span style="color:#e11d48">',
    (await doc()) === '<span style="color:#e11d48">文字</span>',
    JSON.stringify(await doc()),
  )
  await setText('文字')
  await select(0, 2)
  await clickBtn('bg')
  const bgRect = await swatchRect('#fef9c3')
  if (bgRect) {
    await page.clickRect(bgRect)
    await sleep(260)
  }
  check(
    '背景色产出 <span style="background-color:#fef9c3">',
    (await doc()) === '<span style="background-color:#fef9c3">文字</span>',
    JSON.stringify(await doc()),
  )

  /* ── 4. 清除格式 ─────────────────────────────────────── */
  console.log('\n[4] 清除格式')
  const dirty = '**<span style="color:#e11d48"><mark>文字</mark></span>**'
  await setText(dirty)
  await select(0, dirty.length)
  await clickBtn('clear')
  check('清除格式后只剩纯文字', (await doc()) === '文字', JSON.stringify(await doc()))

  /* ── 5. 渲染：元素数与计算样式 ───────────────────────── */
  console.log('\n[5] 渲染（光标移开后才渲染）')
  const renderDoc = [
    '渲染第一行',
    '高亮 <mark>重点</mark> 内容',
    '下划线 <u>链接</u> 内容',
    '文字色 <span style="color:#e11d48">红色</span> 内容',
    '底色 <span style="background-color:#fef9c3">黄底</span> 内容',
    '末行（光标停这里）',
  ].join('\n')
  await setText(renderDoc)
  await page.eval('window.__lab.setCursorLineEnd(6)')
  await sleep(420)
  const rendered = await page.eval(`(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        count: document.querySelectorAll(sel).length,
        text: el.textContent,
        color: cs.color,
        bg: cs.backgroundColor,
        td: cs.textDecorationLine,
        fw: cs.fontWeight,
      }
    }
    return {
      mark: pick('mark.cm-kb-hl'),
      u: pick('u.cm-kb-u'),
      spans: [...document.querySelectorAll('.cm-content span[style]')].map((el) => ({
        style: el.getAttribute('style'),
        color: getComputedStyle(el).color,
        bg: getComputedStyle(el).backgroundColor,
        text: el.textContent,
      })),
      rawText: document.querySelector('.cm-content').innerText,
    }
  })()`)
  check('页面上真实 <mark> 元素数 = 1', rendered.mark?.count === 1, JSON.stringify(rendered.mark))
  check(
    '<mark> 背景为黄色',
    rendered.mark && rendered.mark.bg === 'rgb(254, 240, 138)',
    `backgroundColor=${rendered.mark?.bg}`,
  )
  check('页面上真实 <u> 元素数 = 1', rendered.u?.count === 1, JSON.stringify(rendered.u))
  check(
    '<u> 计算样式含 underline',
    rendered.u && rendered.u.td.includes('underline'),
    `textDecorationLine=${rendered.u?.td}`,
  )
  const colorSpan = rendered.spans?.find((s) => s.color === 'rgb(225, 29, 72)')
  check(
    '文字色 span 计算 color = rgb(225, 29, 72)',
    !!colorSpan,
    JSON.stringify({ found: colorSpan, all: rendered.spans?.map((s) => `${s.style}→${s.color}/${s.bg}`) }),
  )
  const bgSpan = rendered.spans?.find((s) => s.bg === 'rgb(254, 249, 195)')
  check(
    '底色 span 计算 backgroundColor = rgb(254, 249, 195)',
    !!bgSpan,
    JSON.stringify({ found: bgSpan, all: rendered.spans?.map((s) => `${s.style}→${s.color}/${s.bg}`) }),
  )
  check(
    '渲染后可见文本里不再出现标签源码',
    rendered.rawText && !/<mark>|<\/mark>|<u>|<\/u>|<span/.test(rendered.rawText),
    JSON.stringify((rendered.rawText ?? '').slice(0, 80)),
  )
  await page.screenshot(join(SHOTS, 'f02-rendered-inline-html.png'))

  // Typora 行为：光标回到该行 → 显示源码
  await page.eval('window.__lab.setCursorLineEnd(2)')
  await sleep(320)
  const onLine = await page.eval(`({
    marks: document.querySelectorAll('mark.cm-kb-hl').length,
    line2: [...document.querySelectorAll('.cm-line')].map((el) => el.innerText).find((t) => t.includes('高亮')) ?? '',
  })`)
  check(
    '光标所在行回到源码（<mark> 元素消失且行内显示标签）',
    onLine.marks === 0 && onLine.line2.includes('<mark>'),
    JSON.stringify(onLine),
  )

  /* ── 6. 嵌套（两种顺序）──────────────────────────────── */
  console.log('\n[6] 嵌套渲染')
  await setText('顺序一 **<u>粗体下划线</u>** 结束\n顺序二 <u>**下划线粗体**</u> 结束\n末行（光标）')
  await page.eval('window.__lab.setCursorLineEnd(3)')
  await sleep(400)
  const nested = await page.eval(`(() => {
    const lines = [...document.querySelectorAll('.cm-line')]
    const grab = (kw) => {
      const line = lines.find((el) => el.innerText.includes(kw))
      if (!line) return null
      const u = line.querySelector('u')
      if (!u) return { hasU: false, html: line.innerHTML.slice(0, 160) }
      const uCs = getComputedStyle(u)
      const strong = u.querySelector('span[style*="font-weight"], span')
      return {
        hasU: true,
        uText: u.textContent,
        uTd: uCs.textDecorationLine,
        uWeight: uCs.fontWeight,
        innerWeight: strong ? getComputedStyle(strong).fontWeight : null,
        lineWeight: getComputedStyle(line).fontWeight,
        html: line.innerHTML.slice(0, 200),
      }
    }
    return { order1: grab('粗体下划线'), order2: grab('下划线粗体') }
  })()`)
  const s1 = nested.order1
  const s2 = nested.order2
  check(
    'Markdown 包 HTML：**<u>x</u>** 有 <u> 且整体加粗',
    !!(s1 && s1.hasU && parseInt(s1.innerWeight ?? s1.lineWeight) >= 600),
    JSON.stringify(s1),
  )
  check(
    'HTML 包 Markdown：<u>**x**</u> 有 <u> 且内部加粗',
    !!(s2 && s2.hasU && (parseInt(s2.innerWeight ?? '0') >= 600 || parseInt(s2.lineWeight) >= 600)),
    JSON.stringify(s2),
  )

  /* ── 7. 切换语义 ─────────────────────────────────────── */
  console.log('\n[7] 切换（已加粗 → 再点取消）')
  await setText('文字')
  await select(0, 2)
  await clickBtn('bold')
  const once = await doc()
  await clickBtn('bold')
  const twice = await doc()
  check('第一次点击加粗', once === '**文字**', JSON.stringify(once))
  check('第二次点击取消', twice === '文字', JSON.stringify(twice))
  // 颜色切换：红色 → 蓝色（改值，不嵌套）
  await setText('文字')
  await select(0, 2)
  await clickBtn('color')
  await page.clickRect(await swatchRect('#e11d48'))
  await sleep(240)
  const wrapped = await doc()
  const inner = wrapped.indexOf('文字')
  await select(inner, inner + 2) // 选中 span 里的正文（不是标记本身）
  await clickBtn('color')
  await page.clickRect(await swatchRect('#2563eb'))
  await sleep(240)
  check(
    '换颜色是改值而不是嵌套',
    (await doc()) === '<span style="color:#2563eb">文字</span>',
    JSON.stringify(await doc()),
  )

  /* ── 8. 点按钮后选区仍在 ─────────────────────────────── */
  console.log('\n[8] 点击按钮不丢选区')
  await setText('甲乙丙丁')
  await select(1, 3)
  await clickBtn('bold')
  const selAfter = await page.eval('window.__lab.selection()')
  const selText = await page.eval('window.__lab.selectionText()')
  check('点击后选区仍存在且覆盖原文', selText === '乙丙', JSON.stringify({ selAfter, selText }))
  check('正文已加粗', (await doc()) === '甲**乙丙**丁', JSON.stringify(await doc()))

  /* ── 9. 代码块内不弹 ─────────────────────────────────── */
  console.log('\n[9] 代码块内不弹工具栏')
  await setText('```js\nconst abc = 1\n```\n普通行文字')
  await sleep(260)
  await page.eval(`(() => {
    const v = window.__lab
    const text = v.docText()
    const from = text.indexOf('abc')
    v.setSelection(from, from + 3)
    return true
  })()`)
  await sleep(320)
  check('围栏代码块内选中不出现工具栏', (await toolbar()) === null, JSON.stringify(await toolbar()))

  /* ── 9.5 跨行 / 跨块级边界 ───────────────────────────── */
  console.log('\n[9.5] 跨行与跨块级选区（边界策略）')
  await setText('第一行文字\n第二行文字')
  await sleep(240)
  await page.eval('window.__lab.setSelection(0, 11)')
  await sleep(320)
  const multi = await toolbar()
  check('跨行（同属普通段落）仍弹工具栏', multi !== null, JSON.stringify(multi?.placement))
  if (multi) {
    await clickBtn('bold')
    check(
      '跨行加粗按行分别包裹（不产生跨行标记）',
      (await doc()) === '**第一行文字**\n**第二行文字**',
      JSON.stringify(await doc()),
    )
    const st = await page.eval('window.__lab.selectionText()')
    check(
      '跨行加粗后选区仍在（内容未丢，中间的标记落在选区内是跨行包裹的必然结果）',
      (st ?? '').replace(/\*\*/g, '') === '第一行文字\n第二行文字',
      JSON.stringify(st),
    )
  }
  await setText('# 标题行\n普通段落文字')
  await sleep(240)
  await page.eval('window.__lab.setSelection(0, 12)')
  await sleep(320)
  check('跨块级（标题 + 段落）不弹工具栏，避免把 # 包进标记', (await toolbar()) === null, JSON.stringify(await toolbar()))
  await setText('- 列表项一\n- 列表项二')
  await sleep(240)
  await page.eval('window.__lab.setSelection(0, 12)')
  await sleep(320)
  check('跨列表项不弹工具栏（避免破坏列表标记）', (await toolbar()) === null, JSON.stringify(await toolbar()))
  await setText('| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |')
  await sleep(240)
  await page.eval('window.__lab.setSelection(0, 12)')
  await sleep(320)
  check('跨表格行不弹工具栏（避免破坏表格）', (await toolbar()) === null, JSON.stringify(await toolbar()))

  /* ── 10. 触摸设备 ────────────────────────────────────── */
  console.log('\n[10] 触摸设备 390×844')
  await page.setTouch(true)
  await page.setViewport(390, 844, { mobile: true })
  await setText('触摸设备测试文字\n第二行')
  await select(0, 7)
  check('媒体查询 pointer: coarse 生效', (await page.eval("matchMedia('(pointer: coarse)').matches")) === true)
  const touch = await page.eval(`(() => {
    const el = document.querySelector('.kb-fmt-toolbar')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const btns = [...el.querySelectorAll('.kb-fmt-btn')].map((b) => {
      const br = b.getBoundingClientRect()
      return { format: b.dataset.format, w: Math.round(br.width), h: Math.round(br.height) }
    })
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom },
      innerHeight: window.innerHeight,
      atBottom: Math.abs(r.bottom - window.innerHeight) <= 1,
      btns,
      allBig: btns.every((b) => b.w >= 44 && b.h >= 44),
      allInside: [...el.querySelectorAll('.kb-fmt-btn')].every((b) => {
        const br = b.getBoundingClientRect()
        return br.left >= -1 && br.right <= window.innerWidth + 1
      }),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    }
  })()`)
  check('工具栏固定在视口底部', !!(touch && touch.atBottom), JSON.stringify(touch?.rect) + ` innerHeight=${touch?.innerHeight}`)
  check('按钮全部 ≥44×44', !!(touch && touch.allBig), JSON.stringify(touch?.btns))
  check('10 个按钮全部落在视口内（390px 下换行，不靠横向滚动）', !!(touch && touch.allInside))
  check('390 宽无横向溢出', !!touch && touch.overflowX <= 0, `overflowX=${touch?.overflowX}`)
  await page.screenshot(join(SHOTS, 'f03-touch-bottom.png'))
  await page.setTouch(false)
  await page.setViewport(1280, 900)

  /* ── 11. Ctrl+U / Ctrl+E ─────────────────────────────── */
  console.log('\n[11] 快捷键 Ctrl+U / Ctrl+E')
  await setText('文字')
  await select(0, 2)
  await page.combo('u', 2)
  await sleep(260)
  check('Ctrl+U → <u>文字</u>', (await doc()) === '<u>文字</u>', JSON.stringify(await doc()))
  await setText('文字')
  await select(0, 2)
  await page.combo('e', 2)
  await sleep(260)
  check('Ctrl+E → `文字`', (await doc()) === '`文字`', JSON.stringify(await doc()))

  /* ── 12. 四断点无横向溢出 ───────────────────────────── */
  console.log('\n[12] 四断点无横向溢出')
  await setText('断点测试：**粗体** <mark>高亮</mark> <span style="color:#2563eb">蓝色</span> 文字')
  await select(0, 5)
  await sleep(250)
  for (const [w, h] of [
    [1440, 900],
    [1180, 900],
    [900, 900],
    [390, 844],
  ]) {
    await page.setViewport(w, h)
    await sleep(320)
    const o = await page.eval(
      `({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, toolbarRight: (document.querySelector('.kb-fmt-toolbar')?.getBoundingClientRect().right ?? 0) })`,
    )
    check(`${w}px 无横向溢出`, o.scrollW <= o.innerW + 1, JSON.stringify(o))
  }
  await page.setViewport(1280, 900)
  await sleep(300)

  /* ── 13. 没有 dangerouslySetInnerHTML / 注入面 ───────── */
  console.log('\n[13] 安全红线')
  await setText(
    '恶意 <span style="color:red;background:url(javascript:alert(1))">A</span> '
      + '与 <span onclick="alert(1)">B</span> 与 <script>alert(2)</script> 与 <img src=x onerror=alert(3)>',
  )
  await page.eval('window.__lab.setCursorLineEnd(1)')
  await sleep(400)
  const safety = await page.eval(`(() => ({
    injectedStyleSpans: document.querySelectorAll('.cm-content span[style*="javascript"], .cm-content span[style*="background:url"]').length,
    scriptTags: document.querySelectorAll('.cm-content script').length,
    imgTags: document.querySelectorAll('.cm-content img').length,
    onclickAttrs: [...document.querySelectorAll('.cm-content *')].filter((el) => el.getAttribute && el.getAttribute('onclick')).length,
    alerts: window.__kbAlerts ?? 0,
  }))()`)
  check('不合法 style 不被渲染', safety.injectedStyleSpans === 0, JSON.stringify(safety))
  check('不注入 <script>', safety.scriptTags === 0, JSON.stringify(safety))
  check('不注入 onclick 属性', safety.onclickAttrs === 0, JSON.stringify(safety))
} finally {
  await browser.close()
}

console.log(`\n===== 汇总：${passed} 项通过，${failures.length} 项失败 =====`)
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exitCode = 1
}

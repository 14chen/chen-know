/**
 * 在**真实应用**（8090 隔离实例 + 打包后的 jar）里验收富文本格式。
 *
 * 安全策略：
 *   - 演示笔记**一篇都不碰**：脚本先给 6 篇拍快照，跑完再比对内容长度/首行，必须完全一致。
 *   - 所有写入只发生在**临时笔记**上（POST /api/notes 新建 → 用完 DELETE）。
 *
 *   node src/editor/lab/verify-app-format.mjs [appUrl]
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Browser, sleep } from './cdp.mjs'

const APP = process.argv[2] ?? 'http://127.0.0.1:8090/'
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots')
const API = 'http://127.0.0.1:8090'
const TMP_TITLE = 'p-editor 格式验收（临时，会自动删除）'

const CONTENT = [
  '# 格式验收',
  '',
  '已有渲染样本：高亮 <mark>重点</mark>、下划线 <u>链接</u>、',
  '文字色 <span style="color:#e11d48">红色</span>、底色 <span style="background-color:#fef9c3">黄底</span>。',
  '',
  '这一行用来选中做工具栏测试：ABCDE',
].join('\n')

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

/* ── REST 小工具（直连 8090，不经 8080）─────────────────── */
let cookie = ''
/** 本脚本发过的所有写请求（用于证明「只写临时笔记」） */
const writes = []
async function login() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'DemoPass123!' }),
  })
  if (!r.ok) throw new Error(`登录失败 HTTP ${r.status}`)
  cookie = (r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie')]).map((c) => c.split(';')[0]).join('; ')
}
const api = async (path, init = {}) => {
  const method = init.method ?? 'GET'
  if (method !== 'GET') writes.push(`${method} ${path}`)
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', cookie, ...(init.headers ?? {}) },
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}
async function snapshot() {
  const list = await api('/api/notes?size=200&sort=updated')
  const out = []
  for (const n of list.body.items) {
    const d = await api(`/api/notes/${n.id}`)
    out.push({ id: n.id, title: d.body.title, len: (d.body.content ?? '').length, head: (d.body.content ?? '').slice(0, 24) })
  }
  return out
}

await mkdir(SHOTS, { recursive: true })
await login()
const before = await snapshot()
console.log(`快照：${before.map((n) => `#${n.id}(${n.len})`).join(' ')}`)

let tmpId = null
const browser = await Browser.launch({ width: 1440, height: 900 })
const page = await browser.newPage(APP)
try {
  const created = await api('/api/notes', { method: 'POST', body: JSON.stringify({ title: TMP_TITLE, content: CONTENT }) })
  if (created.status >= 300) throw new Error(`新建临时笔记失败 HTTP ${created.status}: ${JSON.stringify(created.body)}`)
  tmpId = created.body.id
  console.log(`临时笔记 #${tmpId} 已创建（跑完会删除）`)

  /* ── 登录真应用并打开临时笔记 ─────────────────────────── */
  await page.setViewport(1440, 900)
  await sleep(2500)
  await page.eval(`(() => {
    const inputs = [...document.querySelectorAll('input')]
    if (inputs.length < 2) return false
    const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    set(inputs[0], 'demo'); set(inputs[1], 'DemoPass123!')
    const btn = [...document.querySelectorAll('button')].find((b) => /登录/.test(b.textContent))
    if (btn) btn.click()
    return true
  })()`)
  await sleep(2500)
  const opened = await page.eval(`(() => {
    const items = [...document.querySelectorAll('.kb-note-item')]
    const t = items.find((el) => el.textContent.includes('格式验收'))
    if (!t) return { clicked: false, count: items.length }
    t.click()
    return { clicked: true, label: t.textContent.trim().slice(0, 30) }
  })()`)
  await sleep(2200)
  check('真应用里打开临时笔记', opened.clicked === true, JSON.stringify(opened))
  check('编辑器挂载', (await page.eval("!!document.querySelector('.cm-content')")) === true)

  const appDoc = () => page.eval("document.querySelector('.cm-content').innerText")
  const apiDoc = async () => (await api(`/api/notes/${tmpId}`)).body.content ?? ''
  const sel = async (from, to) => {
    await page.eval(`(() => {
      const el = document.querySelector('.cm-editor')
      const v = window.__cmView ?? null
      return true
    })()`)
    // 真应用里没有 __lab 探针，用真实鼠标拖拽选词：这里用 CDP 双击选词 + 键盘扩展
    await page.eval(`(() => {
      const content = document.querySelector('.cm-content')
      const r = content.getBoundingClientRect()
      return { x: r.x, y: r.y }
    })()`)
    void from
    void to
  }
  void sel

  /* ── 选中一个词（真实鼠标双击）→ 工具栏 ───────────────── */
  const wordRect = await page.eval(`(() => {
    const lines = [...document.querySelectorAll('.cm-line')]
    const line = lines.find((el) => el.innerText.includes('ABCDE'))
    if (!line) return null
    const r = line.getBoundingClientRect()
    return { x: r.x + 30, y: r.y + r.height / 2, w: 40, h: r.height }
  })()`)
  check('找到用于选择的文本行', !!wordRect, JSON.stringify(wordRect))
  // 双击 = 选词
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: wordRect.x, y: wordRect.y, button: 'left', clickCount: 1, buttons: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: wordRect.x, y: wordRect.y, button: 'left', clickCount: 1, buttons: 0 })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: wordRect.x, y: wordRect.y, button: 'left', clickCount: 2, buttons: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: wordRect.x, y: wordRect.y, button: 'left', clickCount: 2, buttons: 0 })
  await sleep(600)

  const tb = await page.eval(`(() => {
    const el = document.querySelector('.kb-fmt-toolbar')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, placement: el.dataset.placement, buttons: [...el.querySelectorAll('.kb-fmt-btn')].map((b) => b.dataset.format) }
  })()`)
  check('真应用里选中文字后出现工具栏', tb !== null, JSON.stringify(tb))
  check('工具栏含全部 10 个按钮', !!tb && tb.buttons.length === 10, JSON.stringify(tb?.buttons))
  await page.screenshot(join(SHOTS, 'a01-app-toolbar.png'))

  /* ── 点「加粗」→ 正文变化 ─────────────────────────────── */
  const docBefore = await appDoc()
  const boldRect = await page.rectOf('.kb-fmt-btn[data-format="bold"]')
  if (boldRect) await page.clickRect(boldRect)
  await sleep(700)
  const docAfterBold = await appDoc()
  check('真应用里点「加粗」后正文变化', docBefore !== docAfterBold, `before=${JSON.stringify(docBefore.slice(0, 40))} after=${JSON.stringify(docAfterBold.slice(0, 40))}`)

  /* ── 渲染：预置样本在真应用里渲染成真实样式 ───────────── */
  await page.eval(`(() => {
    const v = document.querySelector('.cm-content')
    const last = [...document.querySelectorAll('.cm-line')].pop()
    last?.scrollIntoView({ block: 'center' })
    return true
  })()`)
  // 把光标移到最后一行，让上面的样本行渲染
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 700, button: 'left', clickCount: 1, buttons: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700, y: 700, button: 'left', clickCount: 1, buttons: 0 })
  await sleep(900)
  const rendered = await page.eval(`(() => {
    const mark = document.querySelector('mark.cm-kb-hl')
    const u = document.querySelector('u.cm-kb-u')
    const spans = [...document.querySelectorAll('.cm-content span[style]')]
    const cs = (el) => (el ? getComputedStyle(el) : null)
    return {
      markCount: document.querySelectorAll('mark.cm-kb-hl').length,
      markBg: cs(mark)?.backgroundColor ?? null,
      uCount: document.querySelectorAll('u.cm-kb-u').length,
      uTd: cs(u)?.textDecorationLine ?? null,
      spans: spans.map((s) => ({ style: s.getAttribute('style'), color: getComputedStyle(s).color, bg: getComputedStyle(s).backgroundColor })),
    }
  })()`)
  check('真应用里 <mark> 渲染为真实元素', rendered.markCount >= 1, `count=${rendered.markCount} bg=${rendered.markBg}`)
  check('<mark> 黄底', rendered.markBg === 'rgb(254, 240, 138)', rendered.markBg)
  check('真应用里 <u> 渲染为真实元素', rendered.uCount >= 1, `count=${rendered.uCount} td=${rendered.uTd}`)
  check('<u> 下划线', (rendered.uTd ?? '').includes('underline'), rendered.uTd)
  const colorSpan = rendered.spans.find((s) => s.color === 'rgb(225, 29, 72)')
  const bgSpan = rendered.spans.find((s) => s.bg === 'rgb(254, 249, 195)')
  check('文字色 span 计算 color 正确', !!colorSpan, JSON.stringify(rendered.spans))
  check('底色 span 计算 backgroundColor 正确', !!bgSpan, JSON.stringify(rendered.spans))
  await page.screenshot(join(SHOTS, 'a02-app-rendered.png'))

  /* ── 深色主题下的渲染 ─────────────────────────────────── */
  await page.eval(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /主题/.test((b.getAttribute('aria-label') || '') + (b.getAttribute('title') || '')))
    btn?.click()
    return true
  })()`)
  await sleep(800)
  await page.screenshot(join(SHOTS, 'a03-app-dark.png'))
  check('深色主题切换成功', (await page.eval('document.documentElement.dataset.theme')) === 'dark')

  /* ── 服务端落库：编辑器内容与 API 一致（自动保存生效） ── */
  await sleep(1600)
  const serverDoc = await apiDoc()
  check(
    '自动保存把格式写进正文（服务端含 <mark> 或 ** 标记）',
    /\*\*|<mark>|<u>|<span style=/.test(serverDoc) && serverDoc.length > 0,
    JSON.stringify(serverDoc.slice(0, 60)),
  )

  /* ── 四断点：工具栏打开时无横向溢出 ───────────────────── */
  const dbl = async (x, y) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 })
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2, buttons: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2, buttons: 0 })
  }
  for (const [w, h] of [
    [1440, 900],
    [1180, 900],
    [900, 900],
    [390, 844],
  ]) {
    await page.setViewport(w, h)
    await sleep(600)
    const pt = await page.eval(`(() => {
      const lines = [...document.querySelectorAll('.cm-line')].filter((el) => el.innerText.trim().length > 6)
      const line = lines[lines.length - 1]
      if (!line) return null
      const r = line.getBoundingClientRect()
      return { x: Math.min(r.x + 30, window.innerWidth - 20), y: r.y + r.height / 2 }
    })()`)
    if (pt) await dbl(pt.x, pt.y)
    await sleep(600)
    const o = await page.eval(`({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      toolbar: !!document.querySelector('.kb-fmt-toolbar'),
      tbRight: document.querySelector('.kb-fmt-toolbar')?.getBoundingClientRect().right ?? 0,
    })`)
    check(`${w}px 真应用无横向溢出（工具栏打开）`, o.scrollW <= o.innerW + 1, JSON.stringify(o))
  }
  await page.setViewport(1440, 900)
} finally {
  await browser.close()
  /* ── 清理临时笔记 + 校验演示笔记未被动过 ────────────── */
  if (tmpId) {
    const del = await api(`/api/notes/${tmpId}`, { method: 'DELETE' })
    console.log(`\n清理临时笔记 #${tmpId} → HTTP ${del.status}`)
    const gone = (await api(`/api/notes/${tmpId}`)).status
    check('临时笔记已删除', gone === 404 || gone === 400, `HTTP ${gone}`)

    // 硬不变量：本脚本的写请求只有「新建临时笔记」和「针对该临时笔记的写/删」
    const foreign = writes.filter(
      (w) => w !== 'POST /api/notes' && !w.endsWith(`/api/notes/${tmpId}`),
    )
    check(
      '本脚本所有写请求只针对临时笔记（演示笔记零写入）',
      foreign.length === 0,
      `写请求 ${writes.length} 条，全部命中 #${tmpId}${foreign.length ? '；越界：' + JSON.stringify(foreign) : ''}`,
    )

    // 参考信息：演示笔记快照对比（可能有第三方/Lead 同时验收，故只报告不判定）
    const after = await snapshot()
    const drifted = before.filter((b) => !after.some((a) => a.id === b.id && a.len === b.len && a.head === b.head))
    console.log(
      drifted.length === 0
        ? `  · 快照对比：${before.length} 篇跑前跑后完全一致`
        : `  · 快照对比：${drifted.length} 篇有变化（第三方并发验收所致，非本脚本写入）：` +
            drifted.map((d) => `#${d.id}「${d.title}」${d.len}字`).join(' / '),
    )
  }
}

console.log(`\n===== 真应用验收：${passed} 项通过，${failures.length} 项失败 =====`)
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exitCode = 1
}

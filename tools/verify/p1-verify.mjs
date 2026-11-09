/* 详情页面包屑 / 时间行 / 上下篇 验收 */
import { launch } from './cdp.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const BASE = process.argv[2] || 'http://127.0.0.1:8096'
const SHOTS = fileURLToPath(new URL('./p1-shots/', import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, extra) => { results.push({ n, ok: !!ok, extra: String(extra === undefined ? '' : extra).slice(0, 400) }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '   >> ' + String(extra).slice(0, 400))) }
mkdirSync(SHOTS, { recursive: true })
const browser = await launch()
const page = await browser.newPage(BASE + '/')
const ev = (e) => page.eval(e)
async function loginUi() {
  await page.waitForLoad()
  await page.waitFor("document.querySelector('.kb-login') !== null || document.querySelector('.kb-sidebar') !== null", { timeout: 30000 })
  if (!(await ev("document.querySelector('.kb-login') !== null"))) return
  await ev('(function(){var u=document.querySelector("input[name=username]");var p=document.querySelector("input[name=password]");var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(u,"demo");u.dispatchEvent(new Event("input",{bubbles:true}));s.call(p,"DemoPass123!");p.dispatchEvent(new Event("input",{bubbles:true}));return true})()')
  await page.click('button[type="submit"]')
  await page.waitFor("document.querySelector('.kb-sidebar') !== null", { timeout: 30000 })
  await sleep(700)
}
const crumb = () => 'document.querySelector(".kb-crumb") ? document.querySelector(".kb-crumb").textContent.trim() : ""'
const meta = () => 'document.querySelector(".kb-notemeta") ? document.querySelector(".kb-notemeta").textContent.trim() : ""'
try {
  await page.setViewport(1440, 900)
  await loginUi()

  /* 1a. 根目录笔记 */
  await ev('location.hash = "#/notes/1"')
  await page.waitFor('document.querySelector(".kb-crumb") !== null', { timeout: 25000 })
  await sleep(900)
  const rootCrumb = await ev(crumb())
  check('面包屑①根目录：全部笔记 / 未分类', /^全部笔记\/未分类$/.test(rootCrumb.replace(/\s+/g, '')), rootCrumb)
  await page.screenshot(join(SHOTS, 'p1-crumb-root.png'))

  /* 1b. 三层目录 */
  await ev('location.hash = "#/notes/7"')
  await sleep(1600)
  const deepCrumb = await ev(crumb())
  check('面包屑②三层目录：全部笔记 / 技术博客 / 前端笔记 / 深度', /全部笔记\/技术博客\/前端笔记\/深度/.test(deepCrumb.replace(/\s+/g, '')), deepCrumb)
  await page.screenshot(join(SHOTS, 'p1-crumb-deep.png'))

  /* 1c. 从搜索进入 */
  await ev('location.hash = "#/search?q=' + encodeURIComponent('权限') + '"')
  await page.waitFor('document.querySelector(".vw-row") !== null', { timeout: 25000 })
  await sleep(800)
  await ev('document.querySelector(".vw-row").click()')
  await page.waitFor('document.querySelector(".kb-crumb") !== null', { timeout: 25000 })
  await sleep(900)
  const searchCrumb = await ev(crumb())
  check('面包屑③从搜索进入：搜索「权限」/ …', /^搜索「权限」/.test(searchCrumb.replace(/\s+/g, '')), searchCrumb)
  await page.screenshot(join(SHOTS, 'p1-crumb-search.png'))

  /* 2. 时间行 + 版本自增 */
  await ev('location.hash = "#/notes/8"')
  await page.waitFor('document.querySelector(".kb-notemeta") !== null', { timeout: 25000 })
  await sleep(1000)
  const meta1 = await ev(meta())
  check('时间行：创建 / 更新 / 第 N 版三要素齐全', /创建\s*\d{4}-\d{2}-\d{2}/.test(meta1) && /更新\s*\S+/.test(meta1) && /第\s*\d+\s*版/.test(meta1), meta1)
  const titleAttr = await ev('(function(){var p=document.querySelector(".kb-notemeta");var s=p.querySelectorAll("span[title]");return s.length ? s[0].getAttribute("title") : ""})()')
  check('时间行：「更新」带 title 精确时间', /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(String(titleAttr)), String(titleAttr))
  await page.screenshot(join(SHOTS, 'p1-meta-v1.png'))
  /* 改内容触发保存 → 版本 +1（先自动保存，不成就 Ctrl+S 强制） */
  const beforeVersion = Number((String(meta1).match(/第\s*(\d+)\s*版/) || [])[1] || 0)
  const wantVersion = beforeVersion + 1
  await page.click('.cm-content')
  await sleep(300)
  const focused = await ev('(function(){var a=document.activeElement;return !!(a && (a.classList.contains("cm-content") || a.closest(".cm-editor")))})()')
  check('编辑器可获得焦点（点击正文区）', focused === true, String(focused))
  await page.type('x')
  await sleep(3500)
  let gotVersion = Number((String(await ev(meta())).match(/第\s*(\d+)\s*版/) || [])[1] || 0)
  if (gotVersion !== wantVersion) {
    await page.press('s', { ctrl: true })
    await sleep(3000)
    gotVersion = Number((String(await ev(meta())).match(/第\s*(\d+)\s*版/) || [])[1] || 0)
  }
  const meta2 = await ev(meta())
  check('保存后时间行从第 ' + beforeVersion + ' 版变成第 ' + wantVersion + ' 版（本地自增，未重新拉接口）', gotVersion === wantVersion, String(meta2))
  await page.screenshot(join(SHOTS, 'p1-meta-v2.png'))

  /* 3. 上下篇：按当前真实顺序走链（列表按 updatedAt 倒序，位置会变） */
  const pnState = async () => JSON.parse(await ev('JSON.stringify({prev:!!document.querySelector(".kb-pn__card.is-prev"),next:!!document.querySelector(".kb-pn__card.is-next"),prevTitle:(document.querySelector(".kb-pn__card.is-prev")||{}).textContent||"",nextTitle:(document.querySelector(".kb-pn__card.is-next")||{}).textContent||""})'))
  const goHash = async (hash) => { await ev('location.hash = "' + hash + '"'); await sleep(1200) }
  await goHash('#/notes/8')
  let guard = 0
  let midState = await pnState()
  while (midState.prev && guard < 12) {
    await ev('document.querySelector(".kb-pn__card.is-prev").click()')
    await sleep(1300)
    midState = await pnState()
    guard += 1
  }
  const headId = await ev('location.hash')
  check('上下篇：列表第一篇只有「下一篇」（走到链头验证）', midState.prev === false && midState.next === true, JSON.stringify(midState) + ' at ' + headId)
  await page.screenshot(join(SHOTS, 'p1-pn-first.png'))
  await ev('document.querySelector(".kb-pn__card.is-next").click()')
  await sleep(1300)
  const middleState = await pnState()
  check('上下篇：中间一篇两边都有', middleState.prev === true && middleState.next === true, JSON.stringify(middleState))
  await page.screenshot(join(SHOTS, 'p1-pn-middle.png'))
  let tailGuard = 0
  let tailState = middleState
  while (tailState.next && tailGuard < 12) {
    await ev('document.querySelector(".kb-pn__card.is-next").click()')
    await sleep(1300)
    tailState = await pnState()
    tailGuard += 1
  }
  const tailId = await ev('location.hash')
  check('上下篇：列表最后一篇只有「上一篇」（走到链尾验证）', tailState.prev === true && tailState.next === false, JSON.stringify(tailState) + ' at ' + tailId)
  await page.screenshot(join(SHOTS, 'p1-pn-last.png'))

  /* 4. 点卡片跳转（hash 变化 + 落点与卡片标题一致） */
  const beforeClick = await ev('location.hash')
  const prevCardTitle = String(tailState.prevTitle).replace('← 上一篇', '').trim()
  await ev('document.querySelector(".kb-pn__card.is-prev").click()')
  await sleep(1500)
  const hash1 = await ev('location.hash')
  const landedTitle = await ev('(function(){var i=document.querySelector("textarea, .kb-editor-title");return document.title})()')
  check('点上下篇卡片能跳转（hash 变化且落到上一篇）', hash1 !== beforeClick && /#\/notes\/\d+/.test(String(hash1)) && String(landedTitle).includes(prevCardTitle.slice(0, 6)), beforeClick + ' → ' + hash1 + ' / ' + landedTitle)
  /* 5. Alt + ←/→ */
  const before = await ev('location.hash')
  await page.press('ArrowRight', { alt: true })
  await sleep(1400)
  const afterRight = await ev('location.hash')
  check('Alt+→ 生效（跳到下一篇）', afterRight !== before && /#\/notes\/\d+/.test(String(afterRight)), before + ' → ' + afterRight)
  await page.press('ArrowLeft', { alt: true })
  await sleep(1400)
  const afterLeft = await ev('location.hash')
  check('Alt+← 生效（跳回上一篇）', afterLeft === before, afterRight + ' → ' + afterLeft)

  /* 6. 390 断点 */
  await page.setViewport(390, 844)
  await sleep(900)
  const phone = await ev('(function(){var ov={doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth};var pn=document.querySelector(".kb-pn__card");var r=pn?pn.getBoundingClientRect():null;return JSON.stringify({ov:ov,crumb:!!document.querySelector(".kb-crumb"),meta:!!document.querySelector(".kb-notemeta"),pn:!!document.querySelector(".kb-pn"),cardH:r?Math.round(r.height):0,cols:getComputedStyle(document.querySelector(".kb-pn")).gridTemplateColumns})})()')
  const ph = JSON.parse(phone);
  check('390：三块都在，且无横向溢出', ph.crumb && ph.meta && ph.pn && ph.ov.doc <= ph.ov.client, phone)
  check('390：上下篇单列堆叠，卡片高度 ≥44px', ph.cardH >= 44 && !String(ph.cols).includes(' '), phone)
  await page.screenshot(join(SHOTS, 'p1-phone-390.png'))

  const errs = await page.consoleErrors()
  check('页面无 console 错误', errs.length === 0, JSON.stringify(errs).slice(0, 200))
} finally { await browser.close() }
const passed = results.filter((r) => r.ok).length
const out = results.map((r) => (r.ok ? 'PASS  ' : 'FAIL  ') + r.n + (r.ok ? '' : '   >> ' + r.extra))
out.push('', 'RESULT passed ' + passed + '/' + results.length)
if (passed !== results.length) { out.push('FAILED:'); for (const r of results.filter((x) => !x.ok)) out.push('  - ' + r.n + ' >> ' + r.extra) }
writeFileSync(join(SHOTS, 'result.txt'), out.join('\n') + '\n')
console.log(out.join('\n'))
process.exitCode = passed === results.length ? 0 : 1
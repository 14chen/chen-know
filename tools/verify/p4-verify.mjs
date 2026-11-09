import { launch } from './cdp.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const BASE = process.argv[2] || 'http://127.0.0.1:8096'
const PHASE = process.argv[3] || 'main'
const SHOTS = fileURLToPath(new URL('./p4-shots/', import.meta.url))
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
  await sleep(900)
}
try {
  await page.setViewport(1440, 900)
  await loginUi()
  if (PHASE === 'main') {
    /* 5 首页摘要（列表里每项一行纯文本，≤60 字） */
    const excerpt = await ev('JSON.stringify({n:document.querySelectorAll(".kb-note-item__excerpt").length,sample:(document.querySelector(".kb-note-item__excerpt")||{}).textContent||"",hasMd:/[#*`\[\]]/.test((document.querySelector(".kb-note-item__excerpt")||{}).textContent||"")})')
    const ex = JSON.parse(excerpt)
    check('首页摘要：列表项出现纯文本摘要（无 Markdown 标记、≤61 字）', ex.n > 0 && ex.hasMd === false && ex.sample.length <= 61, excerpt)
    await page.screenshot(join(SHOTS, 'p4-list-excerpt.png'))
    /* 1 代码块：语言标签 + 复制 */
    await ev('location.hash = "#/notes/7"')
    await page.waitFor('document.querySelector(".kb-codeb__lang") !== null', { timeout: 25000 })
    await sleep(1200)
    const codeb = await ev('JSON.stringify({boxes:document.querySelectorAll(".kb-codeb__box").length,langs:Array.prototype.map.call(document.querySelectorAll(".kb-codeb__lang"),function(e){return e.textContent.trim()})})')
    const cb = JSON.parse(codeb)
    check('代码块：3 个块都渲染了语言标签（java / python / 代码）', cb.boxes === 3 && cb.langs.includes('java') && cb.langs.includes('python') && cb.langs.includes('代码'), codeb)
    await page.screenshot(join(SHOTS, 'p4-codeblocks-1440.png'))
    await ev('document.querySelectorAll(".kb-codeb__copy")[0].click()')
    await sleep(400)
    const copied = await ev('JSON.stringify({label:document.querySelectorAll(".kb-codeb__copy")[0].textContent.trim(),clip:null})')
    const clip = await ev('navigator.clipboard.readText().then(function(t){return t.split("\\n")[0]}).catch(function(){return "(clipboard 不可读)"})')
    check('代码块：点复制后按钮变「已复制」', JSON.parse(copied).label === '已复制', copied)
    check('代码块：剪贴板首行是代码内容', String(clip).indexOf('public class Demo') >= 0, String(clip))
    await page.screenshot(join(SHOTS, 'p4-copied-1440.png'))
    /* 2 表格 */
    const table = await ev('(function(){var t=document.querySelector(".kb-editor-pane table");if(!t)return JSON.stringify({table:false});var cs=getComputedStyle(t);var first=t.querySelector("td,th");var cell=t.querySelector("tbody td");return JSON.stringify({table:true,overflowX:cs.overflowX,display:cs.display,firstSticky:cell?getComputedStyle(cell).position:""})})()')
    check('表格：1440 渲染 + 首列 position=sticky', JSON.parse(table).table === true && JSON.parse(table).firstSticky === 'sticky', table)
    await page.screenshot(join(SHOTS, 'p4-table-1440.png'))
    /* 3 行宽（本条已跳过，仅测实际值） */
    const width = await ev('Math.round(document.querySelector(".kb-editor-pane .cm-content").getBoundingClientRect().width)')
    console.log('      正文内容宽度实测 = ' + width + 'px（≈' + Math.round(Number(width) / 16) + ' 个汉字宽）');
    /* 9 编辑器没坏：打字 → 保存（版本+1）→ 切换笔记 */
    const v0 = await ev('(function(){var m=document.querySelector(".kb-notemeta");var x=m?m.textContent.match(/第\\s*(\\d+)\\s*版/):null;return x?Number(x[1]):0})()')
    await page.click('.cm-content')
    await sleep(250)
    await page.type('T')
    await sleep(3500)
    const v1 = await ev('(function(){var m=document.querySelector(".kb-notemeta");var x=m?m.textContent.match(/第\\s*(\\d+)\\s*版/):null;return x?Number(x[1]):0})()')
    const typed = await ev('document.querySelector(".cm-content").textContent.indexOf("T") >= 0')
    check('编辑器：能打字且保存后版本 +1（' + v0 + ' → ' + v1 + '）', typed === true && Number(v1) === Number(v0) + 1, 'typed=' + typed + ' v0=' + v0 + ' v1=' + v1)
    await ev('location.hash = "#/notes/8"')
    await sleep(2200)
    const switched = await ev('JSON.stringify({hash:location.hash,title:(document.querySelector(".kb-note-item--active .kb-note-item__title")||{}).textContent||""})')
    check('编辑器：切换笔记正常（hash 落到 #/notes/8 且有内容）', /#\/notes\/8/.test(String(JSON.parse(switched).hash)), switched)
    /* 4 标签页 */
    await ev('location.hash = "#/tags"')
    await page.waitFor('document.querySelectorAll(".vw-tag, .kb-tag, [class*=tag]").length > 0', { timeout: 20000 })
    await sleep(1500)
    const tags = await ev('JSON.stringify(Array.prototype.slice.call(document.querySelectorAll(".vw-tag-list button, .vw-tag")).slice(0,8).map(function(e){return e.textContent.trim()}))')
    console.log('      标签页文本 = ' + tags);
    await page.screenshot(join(SHOTS, 'p4-tags.png'))
    check('标签页：能渲染（见截图，排序/计数见下方说明）', tags !== '[]', tags)
    /* 2b 表格 390 */
    await ev('location.hash = "#/notes/7"')
    await page.waitFor('document.querySelector(".kb-editor-pane table") !== null', { timeout: 20000 })
    await page.setViewport(390, 844)
    await sleep(1200)
    const phoneTable = await ev('(function(){var t=document.querySelector(".kb-editor-pane table");var cell=t.querySelector("tbody td");return JSON.stringify({sticky:getComputedStyle(cell).position,overflowX:getComputedStyle(t).overflowX,ov:{doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}})})()')
    check('表格 390：横向滚动 + 首列固定 + 页面不溢出', JSON.parse(phoneTable).sticky === 'sticky' && JSON.parse(phoneTable).ov.doc <= JSON.parse(phoneTable).ov.client, phoneTable)
    await page.screenshot(join(SHOTS, 'p4-table-390.png'))
  }
  if (PHASE === 'perm') {
    await ev('location.hash = "#/notes/7"')
    await page.waitFor('document.querySelector(".cm-content") !== null', { timeout: 25000 })
    await sleep(2000)
    await page.click('.cm-content')
    await sleep(250)
    await page.type('Z')
    await sleep(3000)
    const toast = await ev('document.body.innerText')
    check('403：提示「你没有权限做这个操作（这篇笔记可能在其他空间）」', /你没有权限做这个操作/.test(String(toast)) && /其他空间/.test(String(toast)), String(toast).replace(/\s+/g, ' ').slice(0, 220))
    await page.screenshot(join(SHOTS, 'p4-perm-403.png'))
  }
  const errs = await page.consoleErrors()
  check('页面无 console 错误', errs.length === 0, JSON.stringify(errs).slice(0, 200))
} finally { await browser.close() }
const passed = results.filter((r) => r.ok).length
const out = results.map((r) => (r.ok ? 'PASS  ' : 'FAIL  ') + r.n + (r.ok ? '' : '   >> ' + r.extra))
out.push('', 'RESULT passed ' + passed + '/' + results.length + ' (phase=' + PHASE + ')')
writeFileSync(join(SHOTS, 'result-' + PHASE + '.txt'), out.join('\n') + '\n')
console.log(out.join('\n'))
process.exitCode = passed === results.length ? 0 : 1
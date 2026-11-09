import { launch } from './cdp.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const BASE = process.argv[2] || 'http://127.0.0.1:8096'
const PHASE = process.argv[3] || 'main'
const SHOTS = fileURLToPath(new URL('./p5-shots/', import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, extra) => { results.push({ n, ok: !!ok, extra: String(extra === undefined ? '' : extra).slice(0, 380) }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '   >> ' + String(extra).slice(0, 380))) }
mkdirSync(SHOTS, { recursive: true })
const browser = await launch()
const page = await browser.newPage(BASE + '/')
const ev = (e) => page.eval(e)
const BOX = '(function(){var b=document.querySelector(".kb-codeb__box");if(!b)return null;var cs=getComputedStyle(b);var r=b.getBoundingClientRect();return {pe:cs.pointerEvents,op:cs.opacity,cls:b.className,x:Math.round(r.left+20),y:Math.round(r.top+10)}})()'
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
  await ev('location.hash = "#/notes/7"')
  await page.waitFor('document.querySelector(".kb-codeb__box") !== null', { timeout: 25000 })
  await sleep(1500)

  if (PHASE === 'main') {
    /* A. 默认不可点 */
    const d0 = await ev('JSON.stringify(' + BOX + ')')
    const box0 = JSON.parse(d0)
    check('A 工具条默认 pointer-events=none / opacity=0', box0.pe === 'none' && box0.op === '0', d0)
    /* B. 点代码块右上角能进入编辑 */
    const codeRect = await ev('(function(){var l=document.querySelector(".cm-line.cm-kb-code");var r=l.getBoundingClientRect();return JSON.stringify({x:Math.round(r.right-24),y:Math.round(r.top+6),h:Math.round(r.height)})})()')
    const cr = JSON.parse(codeRect)
    await page.clickAt(cr.x, cr.y)
    await sleep(500)
    const focus = await ev('(function(){var a=document.activeElement;return JSON.stringify({inEditor:!!(a&&a.closest&&a.closest(".cm-editor")),cls:a?a.className:""})})()')
    check('B 点代码块右上角后焦点在编辑区（不是被浮层吃掉）', JSON.parse(focus).inEditor === true, focus)
    await page.type('Qz9')
    await sleep(600)
    const typedCode = await ev('document.querySelector(".cm-content").textContent.indexOf("Qz9") >= 0')
    check('B 输入后内容真的变了（代码块里出现 Qz9）', typedCode === true, String(typedCode))
    /* C. 悬停后按钮可点 + 剪贴板桩 */
    await ev('(function(){window.__copied="";if(navigator.clipboard){navigator.clipboard.writeText=function(t){window.__copied=t;return Promise.resolve()}}return true})()')
    await page._send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cr.x, y: cr.y, button: 'none' })
    await sleep(500)
    const d1 = await ev('JSON.stringify(' + BOX + ')')
    const box1 = JSON.parse(d1)
    check('C 悬停后 opacity=1 / pointer-events=auto', box1.op === '1' && box1.pe === 'auto', d1)
    await ev('(function(){var b=document.querySelector(".kb-codeb__box.is-shown .kb-codeb__copy")||document.querySelector(".kb-codeb__copy");b.click();return true})()')
    await sleep(400)
    const copied = await ev('JSON.stringify({first:(window.__copied||"").split(String.fromCharCode(10))[0],label:(document.querySelector(".kb-codeb__copy")||{}).textContent})')
    const cp = JSON.parse(copied)
    check('C 复制桩拿到代码全文，首行正确', String(cp.first).indexOf('public class Demo') >= 0, copied)
    check('C 点复制后按钮变「已复制」', cp.label === '已复制', copied)
    await page.screenshot(join(SHOTS, 'p5-hover.png'))
    /* D. 打字 → 保存 → 版本+1（点正文中间的行） */
    const v0 = await ev('(function(){var m=document.querySelector(".kb-notemeta");var t=m?m.textContent:"";var i=t.indexOf("第 ");var j=t.indexOf(" 版");return i>=0&&j>i?Number(t.slice(i+2,j)):0})()')
    const linePt = await ev('(function(){var ls=Array.prototype.slice.call(document.querySelectorAll(".kb-editor-pane .cm-line"));for(var k=0;k<ls.length;k++){var l=ls[k];if(l.classList.contains("cm-kb-code"))continue;if((l.textContent||"").trim().length>12){var r=l.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+60),y:Math.round(r.top+r.height/2)})}}return null})()')
    const lp = JSON.parse(linePt)
    await page.clickAt(lp.x, lp.y)
    await sleep(400)
    await page.type('Zz1')
    await sleep(3000)
    const v1 = await ev('(function(){var m=document.querySelector(".kb-notemeta");var t=m?m.textContent:"";var i=t.indexOf("第 ");var j=t.indexOf(" 版");return i>=0&&j>i?Number(t.slice(i+2,j)):0})()')
    const hasZ = await ev('document.querySelector(".cm-content").textContent.indexOf("Zz1") >= 0')
    check('D 打字后内容出现 Zz1', hasZ === true, String(hasZ))
    check('D 保存后版本号从 ' + v0 + ' 变成 ' + v1 + '（+1）', Number(v1) === Number(v0) + 1, 'v0=' + v0 + ' v1=' + v1)
    await page.screenshot(join(SHOTS, 'p5-version.png'))
    /* E. 390：工具条不渲染 + 表格横向滚动 + 首列固定 */
    await page.setViewport(390, 844)
    await sleep(1200)
    const phone = await ev('(function(){var t=document.querySelector(".kb-editor-pane table");var cell=t?t.querySelector("tbody td"):null;var sc=t?t.closest(".cm-scroller"):null;return JSON.stringify({banner:!!document.querySelector(".kb-codeb"),tableW:t?Math.round(t.getBoundingClientRect().width):0,scrollW:t?t.scrollWidth:0,clientW:t?t.clientWidth:0,scrollerScroll:sc?sc.scrollWidth:0,scrollerClient:sc?sc.clientWidth:0,sticky:cell?getComputedStyle(cell).position:"",ov:{doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}})})()')
    const ph = JSON.parse(phone)
    check('E 390：工具条不渲染', ph.banner === false, phone)
    check('E 390：表格宽于视口且滚动容器可横向滚动', ph.tableW > 390 && ph.scrollerScroll > ph.scrollerClient, phone)
    check('E 390：首列 position=sticky 且页面不溢出', ph.sticky === 'sticky' && ph.ov.doc <= ph.ov.client, phone)
    await page.screenshot(join(SHOTS, 'p5-table-390.png'))
    /* F. 标签页顺序与计数 */
    await page.setViewport(1440, 900)
    await ev('location.hash = "#/tags"')
    await sleep(2500)
    const tagsDom = await ev('JSON.stringify(Array.prototype.slice.call(document.querySelectorAll("button")).map(function(b){return b.textContent.replace(/\s+/g," ").trim()}).filter(function(t){return t.length>0 && t.length<24}).slice(0,10))')
    console.log('      标签页按钮文本 = ' + tagsDom);
    await page.screenshot(join(SHOTS, 'p5-tags.png'))
    check('F 标签页渲染出标签（截图见 p5-tags.png）', String(tagsDom).length > 5, tagsDom)
  }

  if (PHASE === 'perm') {
    await ev('location.hash = "#/notes/7"')
    await page.waitFor('document.querySelector(".cm-content") !== null', { timeout: 25000 })
    await sleep(2000)
    const pt = await ev('(function(){var ls=Array.prototype.slice.call(document.querySelectorAll(".kb-editor-pane .cm-line"));for(var k=0;k<ls.length;k++){var l=ls[k];if(l.classList.contains("cm-kb-code"))continue;if((l.textContent||"").trim().length>12){var r=l.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+60),y:Math.round(r.top+r.height/2)})}}return null})()')
    const p2 = JSON.parse(pt)
    await page.clickAt(p2.x, p2.y)
    await sleep(300)
    await page.type('Wq2')
    await sleep(3000)
    const text = await ev('document.body.innerText')
    check('403 权限提示文案出现', String(text).indexOf('你没有权限做这个操作') >= 0, String(text).replace(/\s+/g, ' ').slice(0, 240))
    await page.screenshot(join(SHOTS, 'p5-403.png'))
  }

  const errs = await page.consoleErrors()
  check('页面无 console 错误', errs.length === 0, JSON.stringify(errs).slice(0, 200))
} finally { await browser.close() }
const passed = results.filter((r) => r.ok).length
const out = results.map((r) => (r.ok ? 'PASS  ' : 'FAIL  ') + r.n + (r.ok ? '' : '   >> ' + r.extra))
out.push('', 'RESULT passed ' + passed + '/' + results.length + ' (phase=' + PHASE + ')')
writeFileSync(join(SHOTS, 'result-' + PHASE + '.txt'), out.join(String.fromCharCode(10)) + String.fromCharCode(10))
console.log(out.join(String.fromCharCode(10)))
process.exitCode = passed === results.length ? 0 : 1
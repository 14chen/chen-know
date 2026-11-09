/* M1 大纲 / M2 进度条 / M3 相关推荐 验收 */
import { launch } from './cdp.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const BASE = process.argv[2] || 'http://127.0.0.1:8096'
const SHOTS = fileURLToPath(new URL('./p3-shots/', import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, extra) => { results.push({ n, ok: !!ok, extra: String(extra === undefined ? '' : extra).slice(0, 400) }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '   >> ' + String(extra).slice(0, 400))) }
mkdirSync(SHOTS, { recursive: true })
const browser = await launch()
const page = await browser.newPage(BASE + '/')
const ev = (e) => page.eval(e)
const SCROLLER = '.kb-editor-pane .cm-scroller'
async function loginUi() {
  await page.waitForLoad()
  await page.waitFor("document.querySelector('.kb-login') !== null || document.querySelector('.kb-sidebar') !== null", { timeout: 30000 })
  if (!(await ev("document.querySelector('.kb-login') !== null"))) return
  await ev('(function(){var u=document.querySelector("input[name=username]");var p=document.querySelector("input[name=password]");var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(u,"demo");u.dispatchEvent(new Event("input",{bubbles:true}));s.call(p,"DemoPass123!");p.dispatchEvent(new Event("input",{bubbles:true}));return true})()')
  await page.click('button[type="submit"]')
  await page.waitFor("document.querySelector('.kb-sidebar') !== null", { timeout: 30000 })
  await sleep(700)
}
try {
  await page.setViewport(1440, 900)
  await loginUi()
  /* 统计 GET /api/notes/{id} 次数（item 8） */
  await ev('(function(){window.__n=0;var f=window.fetch.bind(window);window.fetch=function(u,o){var s=String(u&&u.url?u.url:u);var i=s.indexOf("/api/notes/");var method=(o&&o.method)?String(o.method).toUpperCase():"GET";if(i>=0&&method==="GET"){var rest=s.slice(i+11);var c=rest.charAt(0);if(c>="0"&&c<="9"&&rest.indexOf("/related")<0)window.__n++}return f(u,o)};return true})()')
  await ev('location.hash = "#/notes/7"')
  await page.waitFor('document.querySelector(".kb-outline") !== null', { timeout: 25000 })
  await sleep(2200)

  /* 1 + 4：大纲数量与不挤压正文 */
  const outline = await ev('JSON.stringify({items:document.querySelectorAll(".kb-outline__item").length,levels:Array.prototype.map.call(document.querySelectorAll(".kb-outline__item"),function(e){return e.className.replace(/.*--l/,"").charAt(0)}).join(""),pos:getComputedStyle(document.querySelector(".kb-outline")).position,left:Math.round(document.querySelector(".kb-outline").getBoundingClientRect().left),right:Math.round(document.querySelector(".kb-outline").getBoundingClientRect().right),paneRight:Math.round(document.querySelector(".kb-editor-pane").getBoundingClientRect().right),contentW:Math.round(document.querySelector(".kb-editor-pane .cm-content").getBoundingClientRect().width),contentRight:Math.round(document.querySelector(".kb-editor-pane .cm-content").getBoundingClientRect().right)})')
  const oj = JSON.parse(outline)
  check('M1 大纲：10 个标题（代码块里 2 行 # 注释没被算进来）', oj.items === 10, outline)
  check('M1 大纲：三级标题都有（1/2/3 层级都存在）', oj.levels.includes('1') && oj.levels.includes('2') && oj.levels.includes('3'), oj.levels)
  check('M1 大纲：浮在正文右侧留白（正文右缘→面板左缘 ≥24px）且不超出视口', (oj.pos === 'fixed' || oj.pos === 'absolute') && oj.left - oj.contentRight >= 24 && oj.right <= 1440, 'pos=' + oj.pos + ' left=' + oj.left + ' right=' + oj.right + ' contentRight=' + oj.contentRight + ' gap=' + (oj.left - oj.contentRight))
  await page.screenshot(join(SHOTS, 'p3-outline-1440.png'))
  /* 点第 3 项 → 滚动位置变化 */
  const before = await ev('Math.round(document.querySelector("' + SCROLLER + '").scrollTop)')
  await ev('document.querySelectorAll(".kb-outline__item")[2].click()')
  await sleep(1600)
  const afterJump = await ev('Math.round(document.querySelector("' + SCROLLER + '").scrollTop)')
  check('M1 大纲：点第 3 项后滚动位置变化', Number(afterJump) !== Number(before), before + ' → ' + afterJump)
  await page.screenshot(join(SHOTS, 'p3-outline-jumped.png'))

  /* 2：滚到中间 → 高亮项 */
  await ev('(function(){var s=document.querySelector("' + SCROLLER + '");s.scrollTop=Math.round(s.scrollHeight*0.45);return true})()')
  await sleep(1400)
  await sleep(400)
  const active = await ev('(function(){var a=document.querySelector(".kb-outline__item.is-active");return JSON.stringify({text:a?a.textContent.trim():"",current:a?a.getAttribute("aria-current"):null})})()')
  const aj = JSON.parse(active)
  check('M1 大纲：滚动后自动高亮当前小节（aria-current=true）', aj.text.length > 0 && aj.current === 'true', active)
  await page.screenshot(join(SHOTS, 'p3-outline-active.png'))

  /* 5：进度条 */
  const bar1 = await ev('(function(){var s=document.querySelector(".kb-editor-pane .cm-scroller");s.scrollTop=Math.round(s.scrollHeight*0.5);var b=document.querySelector(".kb-progress__bar");return new Promise(function(res){setTimeout(function(){res(JSON.stringify({opacity:getComputedStyle(b).opacity,cls:b.className,width:b.style.width}))},250)})})()')
  await sleep(1900)
  const bar2 = await ev('(function(){var b=document.querySelector(".kb-progress__bar");return JSON.stringify({opacity:getComputedStyle(b).opacity,cls:b.className})})()')
  check('M2 进度条：滚动时可见（opacity=1）', JSON.parse(bar1).opacity === '1', bar1)
  check('M2 进度条：停止 1.5s 后淡出（opacity=0）', JSON.parse(bar2).opacity === '0', bar2)
  await page.screenshot(join(SHOTS, 'p3-progress-faded.png'))

  /* 3：收起 + 刷新后仍是收起 */
  await ev('document.querySelector(".kb-outline__collapse").click()')
  await sleep(600)
  const collapsed = await ev('JSON.stringify({panel:!!document.querySelector(".kb-outline[aria-label]"),btn:!!document.querySelector(".kb-outline__collapsed"),stored:localStorage.getItem("kb.outline.open")})')
  check('M1 大纲：一键收起（面板消失、只剩「目录」按钮、localStorage=0）', JSON.parse(collapsed).panel === false && JSON.parse(collapsed).btn === true && JSON.parse(collapsed).stored === '0', collapsed)
  await page.screenshot(join(SHOTS, 'p3-outline-collapsed.png'))
  await ev('(function(){location.reload();return true})()')
  await sleep(3200)
  await page.waitFor('document.querySelector(".kb-outline__collapsed") !== null', { timeout: 20000 })
  const afterReload = await ev('JSON.stringify({panel:!!document.querySelector(".kb-outline[aria-label]"),btn:!!document.querySelector(".kb-outline__collapsed")})')
  check('M1 大纲：刷新后仍是收起状态', JSON.parse(afterReload).panel === false && JSON.parse(afterReload).btn === true, afterReload)
  await ev('document.querySelector(".kb-outline__collapsed").click()')
  await sleep(800)

  /* 6：相关推荐 */
  await page.waitFor('document.querySelector(".kb-related") !== null', { timeout: 20000 })
  await sleep(600)
  const related = await ev('JSON.stringify({rows:document.querySelectorAll(".kb-related__row").length,reasons:Array.prototype.map.call(document.querySelectorAll(".kb-related__reason"),function(e){return e.textContent.trim()}),count:(document.querySelector(".kb-related__count")||{}).textContent})')
  const rj = JSON.parse(related)
  check('M3 相关推荐：3 条且每条带 reasonLabel', rj.rows === 3 && rj.reasons.length === 3 && /同目录/.test(rj.reasons[0]), related)
  await page.screenshot(join(SHOTS, 'p3-related.png'))
  const beforeRel = await ev('location.hash')
  await ev('document.querySelector(".kb-related__row").click()')
  await sleep(1600)
  const afterRel = await ev('location.hash')
  check('M3 相关推荐：点一条能跳转（hash 变化）', afterRel !== beforeRel && /#\/notes\/\d+/.test(String(afterRel)), beforeRel + ' → ' + afterRel)

  /* 7：空相关 → 整块不渲染 */
  await ev('location.hash = "#/notes/11"')
  await sleep(2600)
  const lonely = await ev('JSON.stringify({related:!!document.querySelector(".kb-related"),text:document.body.innerText.includes("相关笔记")})')
  check('M3 相关推荐：空数组时整块不渲染（DOM 里搜不到「相关笔记」）', JSON.parse(lonely).related === false && JSON.parse(lonely).text === false, lonely)

  /* 8：打开笔记只发 1 次 GET /api/notes/{id}（页面在 item 3 重载过，计数钩子要重新装） */
  await ev('(function(){window.__n=0;var f=window.fetch.bind(window);window.fetch=function(u,o){var s=String(u&&u.url?u.url:u);var i=s.indexOf("/api/notes/");var method=(o&&o.method)?String(o.method).toUpperCase():"GET";if(i>=0&&method==="GET"){var rest=s.slice(i+11);var c=rest.charAt(0);if(c>="0"&&c<="9"&&rest.indexOf("/related")<0)window.__n++}return f(u,o)};return true})()')
  await ev('location.hash = "#/notes/7"')
  await sleep(2600)
  const calls = await ev('window.__n')
  check('重复请求已消除：打开一篇笔记只发 1 次 GET /api/notes/{id}', Number(calls) === 1, 'count=' + calls)

  /* 平板 900–1179：默认收起，点按钮右侧抽屉 */
  await page.setViewport(1024, 800)
  await sleep(1000)
  const tabletBtn = await ev('JSON.stringify({btn:!!document.querySelector(".kb-outline--drawer .kb-outline__collapsed"),panel:!!document.querySelector(".kb-outline[aria-label]")})')
  check('平板 1024：默认收起为「目录」按钮（不常驻面板）', JSON.parse(tabletBtn).btn === true && JSON.parse(tabletBtn).panel === false, tabletBtn)
  await ev('document.querySelector(".kb-outline--drawer .kb-outline__collapsed").click()')
  await sleep(600)
  const tabletDrawer = await ev('(function(){var s=document.querySelector(".kb-outline__side");if(!s)return JSON.stringify({side:false});var r=s.getBoundingClientRect();return JSON.stringify({side:true,right:Math.round(r.right),items:s.querySelectorAll(".kb-outline__item").length,ov:{doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}})})()')
  check('平板 1024：点「目录」从右侧滑出抽屉（10 项、不溢出）', JSON.parse(tabletDrawer).side === true && JSON.parse(tabletDrawer).items === 10 && JSON.parse(tabletDrawer).ov.doc <= JSON.parse(tabletDrawer).ov.client, tabletDrawer)
  await page.screenshot(join(SHOTS, 'p3-tablet-drawer.png'))
  await page.setViewport(1440, 900)
  await sleep(800)

  /* 9：390 顶部「目录」按钮 + 底部抽屉 */
  await page.setViewport(390, 844)
  await sleep(1200)
  const phoneBtn = await ev('JSON.stringify({btn:!!document.querySelector(".kb-outline__toggle"),panel:!!document.querySelector(".kb-outline[aria-label]"),ov:{doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}})')
  check('390：不显示右侧大纲，改为顶部「目录」按钮 + 无横向溢出', JSON.parse(phoneBtn).btn === true && JSON.parse(phoneBtn).panel === false && JSON.parse(phoneBtn).ov.doc <= JSON.parse(phoneBtn).ov.client, phoneBtn)
  await page.screenshot(join(SHOTS, 'p3-phone-button.png'))
  const sheetBefore = await ev('!!document.querySelector(".kb-outline__sheet")')
  if (!sheetBefore) { await ev('document.querySelector(".kb-outline__toggle").click()'); await sleep(700) }
  const sheet = await ev('JSON.stringify({sheet:!!document.querySelector(".kb-outline__sheet"),items:document.querySelectorAll(".kb-outline__sheet .kb-outline__item").length})')
  check('390：点「目录」从底部滑出抽屉', JSON.parse(sheet).sheet === true && JSON.parse(sheet).items === 10, sheet)
  await page.screenshot(join(SHOTS, 'p3-phone-sheet.png'))

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
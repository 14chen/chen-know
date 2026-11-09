/* H3 历史 / H4 防抖+联想 / 空结果分流的验收 */
import { launch } from './cdp.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const BASE = process.argv[2] || 'http://127.0.0.1:8096'
const SHOTS = fileURLToPath(new URL('./s2-shots/', import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, extra) => { results.push({ n, ok: !!ok, extra: String(extra === undefined ? '' : extra).slice(0, 400) }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '   >> ' + String(extra).slice(0, 400))) }
mkdirSync(SHOTS, { recursive: true })
const browser = await launch()
const page = await browser.newPage(BASE + '/')
const ev = (e) => page.eval(e)
const INPUT = '.vw-search-field input'
const clearInput = async () => { await ev('(function(){var i=document.querySelector(' + JSON.stringify(INPUT) + ');var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(i,"");i.dispatchEvent(new Event("input",{bubbles:true}));i.focus();return true})()'); await sleep(300) }
const typeInto = async (text, perChar = 25) => { await ev('(function(){var i=document.querySelector(\'' + INPUT + '\');i.focus();return true})()'); await page.type(text, { perChar }) }
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
  await ev('location.hash = "#/search"')
  await page.waitFor('document.querySelector(\'' + INPUT + '\') !== null', { timeout: 25000 })
  await sleep(800)
  /* 统计 fetch：/api/search? 与 /api/search/suggest 分别计数 */
  await ev('(function(){window.__c={search:0,suggest:0};var f=window.fetch.bind(window);window.fetch=function(u,o){var s=String(u&&u.url?u.url:u);if(s.indexOf("/api/search/suggest")>=0)window.__c.suggest++;else if(s.indexOf("/api/search")>=0)window.__c.search++;return f(u,o)};return true})()')

  /* 1. 防抖：连续 5 个字符 → 1 次 /api/search */
  await clearInput()
  await ev('(function(){window.__c.search=0;window.__c.suggest=0;return true})()')
  await typeInto('权限模型设', 20)
  await sleep(1600)
  const deb = await ev('JSON.stringify(window.__c)')
  const d = JSON.parse(deb)
  check('防抖：连续输入 5 个字符只发 1 次 /api/search', d.search === 1, deb)

  /* 2. 联想词浮层 */
  await clearInput()
  await typeInto('权', 20)
  await page.waitFor('document.querySelector(".vw-search-pop") !== null', { timeout: 15000 })
  await sleep(400)
  const pop = await ev('JSON.stringify({items:document.querySelectorAll(".vw-search-pop__item").length,kinds:Array.prototype.map.call(document.querySelectorAll(".vw-search-pop__kind"),function(e){return e.textContent.trim()}),expanded:document.querySelector(\'' + INPUT + '\').getAttribute("aria-expanded"),role:document.querySelector(\'' + INPUT + '\').getAttribute("role")})')
  const pj = JSON.parse(pop)
  check('联想①：输入「权」出现浮层，含 tag 与 title 两种', pj.items >= 2 && pj.kinds.includes('标签') && pj.kinds.includes('标题'), pop)
  check('联想①：输入框 role=combobox / aria-expanded=true', pj.role === 'combobox' && pj.expanded === 'true', pop)
  await page.screenshot(join(SHOTS, 's2-suggest-1440.png'))
  await page.press('ArrowDown')
  await sleep(250)
  const act1 = await ev('document.querySelector(\'' + INPUT + '\').getAttribute("aria-activedescendant")')
  await page.press('ArrowDown')
  await sleep(250)
  const act2 = await ev('document.querySelector(\'' + INPUT + '\').getAttribute("aria-activedescendant")')
  check('联想②：↑↓ 能移动高亮（aria-activedescendant 变化）', act1 === 'kb-search-option-0' && act2 === 'kb-search-option-1', act1 + ' → ' + act2)
  const picked = await ev('(function(){var e=document.querySelector("#kb-search-option-1");return e?e.textContent.trim():"(none)"})()')
  await page.press('Enter')
  await sleep(1200)
  const afterEnter = await ev('JSON.stringify({hash:location.hash,value:document.querySelector(\'' + INPUT + '\').value})')
  check('联想③：Enter 选中联想词并立即搜索', String(picked).length > 0 && JSON.parse(afterEnter).hash.includes('q='), picked + ' | ' + afterEnter)
  await clearInput()
  await typeInto('鉴', 20)
  await page.waitFor('document.querySelector(".vw-search-pop") !== null', { timeout: 15000 })
  await page.press('Escape')
  await sleep(300)
  const esc = await ev('JSON.stringify({pop:!!document.querySelector(".vw-search-pop"),focused:document.activeElement === document.querySelector(\'' + INPUT + '\')})')
  check('联想④：Esc 只关浮层、焦点仍在输入框', JSON.parse(esc).pop === false && JSON.parse(esc).focused === true, esc)

  /* 3. 输入法 composition 期间不请求联想 */
  await clearInput()
  await ev('(function(){window.__c.suggest=0;window.__c.search=0;return true})()')
  await ev('(function(){var i=document.querySelector(\'' + INPUT + '\');i.focus();i.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:""}));return true})()')
  await page.type('quan', { perChar: 40 })
  await sleep(900)
  const duringComp = await ev('JSON.stringify(window.__c)')
  await ev('(function(){var i=document.querySelector(\'' + INPUT + '\');i.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"权"}));return true})()')
  await sleep(700)
  const afterComp = await ev('JSON.stringify(window.__c)')
  check('组合输入期间不发联想请求（compositionstart→end 之间 suggest=0）', JSON.parse(duringComp).suggest === 0, 'during=' + duringComp + ' after=' + afterComp)

  /* 4. 历史：先清空，再搜 3 个不同关键词 */
  await ev('(function(){localStorage.removeItem("kb.search.history");return true})()')
  await ev('location.hash = "#/search"')
  await sleep(600)
  await ev('(function(){location.reload();return true})()')
  await sleep(3000)
  await page.waitFor('document.querySelector(\'' + INPUT + '\') !== null', { timeout: 20000 })
  await sleep(500)
  for (const kw of ['权限', '鉴权', '后端']) {
    await clearInput()
    await typeInto(kw, 25)
    await page.press('Enter')
    await sleep(1100)
  }
  const stored = await ev('localStorage.getItem("kb.search.history")')
  const parsedHistory = JSON.parse(String(stored || '[]'))
  check('历史：localStorage kb.search.history 记下 3 条（最新在前）', Array.isArray(parsedHistory) && parsedHistory.length === 3 && parsedHistory[0] === '后端', String(stored))
  await clearInput()
  await page.waitFor('document.querySelector(".vw-search-pop") !== null', { timeout: 15000 })
  await sleep(400)
  const histItems = await ev('document.querySelectorAll(".vw-search-pop__item").length')
  check('历史：输入框空 + 聚焦时显示下拉（3 条）', Number(histItems) === 3, 'items=' + histItems)
  await page.screenshot(join(SHOTS, 's2-history-1440.png'))
  await ev('document.querySelector(".vw-search-pop__x").click()')
  await sleep(500)
  const afterDel = await ev('JSON.stringify({items:document.querySelectorAll(".vw-search-pop__item").length,stored:localStorage.getItem("kb.search.history")})')
  check('历史：单条 × 删除生效', JSON.parse(afterDel).items === 2, afterDel)
  await page.screenshot(join(SHOTS, 's2-history-deleted.png'))
  await ev('document.querySelector(".vw-search-pop__clear").click()')
  await sleep(500)
  const afterClear = await ev('JSON.stringify({pop:!!document.querySelector(".vw-search-pop"),stored:localStorage.getItem("kb.search.history")})')
  check('历史：清空历史后内存/存储都空', JSON.parse(afterClear).stored === '[]', afterClear)

  /* 5. 空结果 A */
  await clearInput()
  await typeInto('zzzz', 20)
  await page.press('Enter')
  await page.waitFor('document.querySelector(".vw-state") !== null', { timeout: 20000 })
  await sleep(800)
  const emptyA = await ev('document.querySelector(".vw-state").innerText')
  check('空结果 A：没有找到和「zzzz」相关的笔记 + 换个说法提示', /没有找到和「zzzz」相关的笔记/.test(String(emptyA)) && /换个说法/.test(String(emptyA)), String(emptyA).replace(/\s+/g, ' ').slice(0, 160))
  await page.screenshot(join(SHOTS, 's2-empty-a.png'))

  /* 6. 空结果 B：有结果的关键词 + 空目录筛选 */
  await ev('location.hash = "#/search?q=' + encodeURIComponent('权限') + '&folderId=2"')
  await page.waitFor('document.querySelector(".vw-state") !== null', { timeout: 20000 })
  await sleep(1500)
  const emptyB = await ev('document.querySelector(".vw-state").innerText')
  check('空结果 B：提示有几个条件在生效 + 列出条件', /个条件正在生效/.test(String(emptyB)) && /目录：空目录/.test(String(emptyB)), String(emptyB).replace(/\s+/g, ' ').slice(0, 200))
  check('空结果 B：明确「去掉筛选后能找到 N 条」', /去掉筛选后能找到\s*\d+\s*条/.test(String(emptyB)), String(emptyB).replace(/\s+/g, ' ').slice(0, 200))
  const hasClear = await ev('Array.prototype.some.call(document.querySelectorAll(".vw-state button"),function(b){return b.textContent.trim()==="清除筛选"})')
  check('空结果 B：有显眼的「清除筛选」按钮', hasClear === true, String(hasClear))
  await page.screenshot(join(SHOTS, 's2-empty-b.png'))
  await ev('Array.prototype.find.call(document.querySelectorAll(".vw-state button"),function(b){return b.textContent.trim()==="清除筛选"}).click()')
  await sleep(1600)
  const restored = await ev('JSON.stringify({hash:location.hash,rows:document.querySelectorAll(".vw-row").length})')
  check('空结果 B：点清除筛选后结果恢复', JSON.parse(restored).rows > 0 && !String(JSON.parse(restored).hash).includes('folderId'), restored)

  /* 7. 390：浮层不超出屏幕 */
  await page.setViewport(390, 844)
  await sleep(700)
  await clearInput()
  await typeInto('权', 20)
  await page.waitFor('document.querySelector(".vw-search-pop") !== null', { timeout: 15000 })
  await sleep(500)
  const phone = await ev('(function(){var p=document.querySelector(".vw-search-pop").getBoundingClientRect();return JSON.stringify({left:Math.round(p.left),right:Math.round(p.right),vw:window.innerWidth,doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,scrollH:p.height})})()')
  const pv = JSON.parse(phone)
  check('390：浮层不超出屏幕 + 无横向溢出', pv.left >= 0 && pv.right <= pv.vw && pv.doc <= pv.client, phone)
  await page.screenshot(join(SHOTS, 's2-phone-390.png'))

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
/* 开源周报验收：node weekly-verify.mjs --base http://127.0.0.1:8096 --api http://127.0.0.1:8095 --phase real|canned */
import { launch } from './cdp.mjs'
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const BASE = arg('--base', 'http://127.0.0.1:8096')
const API = arg('--api', 'http://127.0.0.1:8095')
const PHASE = arg('--phase', 'real')
const SHOTS = fileURLToPath(new URL('./weekly-shots/', import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, extra) => { results.push({ name, ok: !!ok, extra: String(extra === undefined ? '' : extra).slice(0, 400) }); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '   >> ' + String(extra).slice(0, 400))) }
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
  await sleep(800)
}

const runBtn = 'Array.prototype.find.call(document.querySelectorAll("button"),function(b){return /一键获取本周周报|正在获取/.test(b.textContent)})'

try {
  await page.setViewport(1440, 900)
  await loginUi()

  /* 1. 侧栏入口顺序 */
  const nav = await ev('JSON.stringify(Array.prototype.slice.call(document.querySelectorAll(".kb-sidebar button, .kb-sidebar a")).map(function(e){return (e.textContent||"").trim()}).filter(function(t){return t.length>0&&t.length<10}))')
  const list = JSON.parse(nav)
  const iBrief = list.indexOf('AI 简报');
  const iWeekly = list.indexOf('开源周报');
  check('侧栏有「开源周报」且在「AI 简报」之后', iWeekly >= 0 && iWeekly === iBrief + 1, nav)

  await ev('location.hash = "#/weekly"')
  await page.waitFor('document.querySelector(".vw-weekly__section") !== null', { timeout: 30000 })
  await sleep(2500)

  if (PHASE === 'real') {
    /* 空态（目录已清空） */
    const emptyText = await ev('document.body.innerText')
    check('空态：还没有周报时给引导', /还没有生成过开源周报/.test(String(emptyText)), String(emptyText).replace(/\s+/g, ' ').slice(0, 140))
    await page.screenshot(join(SHOTS, 'weekly-empty-1440.png'))

    /* 2 + 10. 点「一键获取本周周报」→ 加载态 */
    await ev(runBtn + '.click()')
    await sleep(800)
    const loading = await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("button"),function(x){return /正在获取/.test(x.textContent)});var strip=document.querySelector(".vw-weekly__strip");return JSON.stringify({text:b?b.textContent.trim():"",disabled:b?b.disabled:null,ariaBusy:b?b.getAttribute("aria-busy"):null,ariaDisabled:b?b.getAttribute("aria-disabled"):null,cls:strip?strip.className:"",strip:strip?strip.textContent.trim():"",live:document.querySelector(".vw-weekly__banner").getAttribute("aria-live")})})()')
    const ld = JSON.parse(loading)
    check('加载态：按钮文案「正在获取…」且 disabled', ld.text === '正在获取…' && ld.disabled === true, loading)
    check('加载态：aria-busy=true / aria-disabled=true', ld.ariaBusy === 'true' && ld.ariaDisabled === 'true', loading)
    check('加载态：提示「正在抓取 GitHub 与 Gitee，约需 15–40 秒」', /正在抓取 GitHub 与 Gitee/.test(ld.strip) && /15–40 秒/.test(ld.strip) && /is-info/.test(ld.cls), ld.strip)
    check('提示条容器 aria-live=polite', ld.live === 'polite', String(ld.live))
    await page.screenshot(join(SHOTS, 'weekly-loading-1440.png'))

    /* 3. 成功态 */
    await page.waitFor('document.querySelector(".vw-weekly__strip.is-success, .vw-weekly__strip.is-warning, .vw-weekly__strip.is-error") !== null', { timeout: 120000 })
    await sleep(800)
    const terminal = await ev('(function(){var s=document.querySelector(".vw-weekly__strip");return JSON.stringify({cls:s.className,text:s.textContent.trim(),hasView:Array.prototype.some.call(s.querySelectorAll("button"),function(b){return /查看本周项目/.test(b.textContent)})})})()')
    const t = JSON.parse(terminal)
    console.log('      真实运行终态: ' + t.cls + ' | ' + t.text)
    check('成功态：绿条「已生成 10 篇（GitHub 5 · Gitee 5）」', /is-success/.test(t.cls) && /已生成 10 篇（GitHub 5 · Gitee 5）/.test(t.text), terminal)
    check('成功态：带「查看本周项目」按钮', t.hasView === true, terminal)
    await page.screenshot(join(SHOTS, 'weekly-success-1440.png'))

    /* 6. 卡片（等列表刷新完成） */
    await page.waitFor('document.querySelectorAll(".vw-weekly__card:not(.vw-weekly__card--skeleton)").length === 10', { timeout: 40000 })
    const cards = await ev('JSON.stringify({total:document.querySelectorAll(".vw-weekly__card:not(.vw-weekly__card--skeleton)").length,groups:Array.prototype.map.call(document.querySelectorAll(".vw-weekly__group-title"),function(h){return h.textContent.trim()}),chips:Array.prototype.slice.call(document.querySelectorAll(".vw-weekly__chip"),0,6).map(function(c){return c.textContent.trim()}),firstTitle:(document.querySelector(".vw-weekly__card-title")||{}).textContent,firstValue:(document.querySelector(".vw-weekly__card-value")||{}).textContent})')
    const c = JSON.parse(cards)
    check('本周项目：渲染出 10 张卡片', c.total === 10, cards)
    check('本周项目：GitHub / Gitee 两组各 5 个', c.groups.length === 2 && /GitHub 5/.test(c.groups[0]) && /Gitee 5/.test(c.groups[1]), JSON.stringify(c.groups))
    // 首次收录时后端写的是「本周新增 ⭐ —（首次收录，下周起显示）」→ 没有 +N 就不显示（不瞎猜）
    check('卡片显示「总星 / 语言」（有历史快照时才有「本周 +N」）', /总星/.test(c.chips.join(' ')) && c.chips.length >= 2, JSON.stringify(c.chips))
    check('卡片显示一句话价值', String(c.firstValue).length > 20, String(c.firstValue).slice(0, 80))
    await page.screenshot(join(SHOTS, 'weekly-cards-1440.png'))

    /* 7. 点卡片 */
    await ev('document.querySelector(".vw-weekly__card:not(.vw-weekly__card--skeleton)").click()')
    await sleep(1500)
    const hash = await ev('location.hash')
    check('点卡片打开对应笔记（#/notes/{id}）', /#\/notes\/\d+/.test(String(hash)), String(hash))

    /* 运行历史 */
    await ev('location.hash = "#/weekly"')
    await page.waitFor('document.querySelector(".vw-weekly__table tbody tr") !== null', { timeout: 30000 })
    await sleep(800)
    const rows = await ev('document.querySelectorAll(".vw-weekly__table tbody tr").length')
    check('运行历史表格出现记录', Number(rows) >= 1, 'rows=' + rows)

    /* 8. 390 断点 */
    await page.setViewport(390, 844)
    await sleep(900)
    const phone = await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("button"),function(x){return /一键获取本周周报|正在获取/.test(x.textContent)});var r=b.getBoundingClientRect();return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),ov:{doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}})})()')
    const ph = JSON.parse(phone)
    check('390：主按钮全宽且高度 ≥44px', ph.w >= 320 && ph.h >= 44, phone)
    check('390：无横向溢出', ph.ov.doc <= ph.ov.client, JSON.stringify(ph.ov))
    await page.screenshot(join(SHOTS, 'weekly-phone-390.png'))
    await page.setViewport(1440, 900)
    await sleep(700)

    /* 4. 409 二次确认（真实并发触发的 409） */
    await ev('(function(){ window.__firstRun = fetch("/api/weekly/run",{method:"POST"}); return true })()')
    await sleep(400)
    await ev(runBtn + '.click()')
    await page.waitFor('document.querySelector(".kb-modal") !== null', { timeout: 40000 })
    await sleep(500)
    const dialog = await ev('document.querySelector(".kb-modal").innerText')
    check('409：弹出二次确认（含「已经生成过」并说明不会重复）', /已经生成过/.test(String(dialog)) && /不会重复生成/.test(String(dialog)), String(dialog).replace(/\s+/g, ' ').slice(0, 200))
    await page.screenshot(join(SHOTS, 'weekly-409-confirm-1440.png'))
    const cancelBtn = await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll(".kb-modal button"),function(x){return x.textContent.trim()==="取消"});if(!b)return false;b.click();return true})()')
    check('409：确认框有「再生成 / 取消」', cancelBtn === true, String(cancelBtn))
    await sleep(800)
  }
  if (PHASE === 'canned') {
    await page.setViewport(1440, 900)
    await sleep(500)
    await ev(runBtn + '.click()')
    await page.waitFor('document.querySelector(".vw-weekly__strip.is-success") !== null', { timeout: 60000 })
    await sleep(600);
    const ok = await ev('document.querySelector(".vw-weekly__strip").textContent.trim()')
    check('成功态：显示「已生成 10 篇（GitHub 5 · Gitee 5）」', /已生成 10 篇（GitHub 5 · Gitee 5）/.test(String(ok)), String(ok))
    const hasView = await ev('Array.prototype.some.call(document.querySelectorAll(".vw-weekly__strip button"),function(b){return /查看本周项目/.test(b.textContent)})')
    check('成功态：带「查看本周项目」按钮', hasView === true, String(hasView))
    await page.screenshot(join(SHOTS, 'weekly-success-1440.png'))
  }

  if (PHASE === 'fail') {
    await page.setViewport(1440, 900)
    await sleep(400)
    await ev(runBtn + '.click()')
    await page.waitFor('document.querySelector(".vw-weekly__strip.is-error") !== null', { timeout: 60000 })
    await sleep(600)
    const strip = await ev('(function(){var s=document.querySelector(".vw-weekly__strip");return JSON.stringify({cls:s.className,text:s.textContent.trim(),hasRetry:Array.prototype.some.call(s.querySelectorAll("button"),function(b){return /重试/.test(b.textContent)})})})()')
    const st = JSON.parse(strip)
    check('失败态：红色条显示后端具体原因', /is-error/.test(st.cls) && /Gitee数据未更新/.test(st.text), strip)
    check('失败态：带「重试」按钮', st.hasRetry === true, strip)
    await page.screenshot(join(SHOTS, 'weekly-error-1440.png'))
  }
  const consoleErrs = await page.consoleErrors()
  check('页面无 console 错误', consoleErrs.length === 0, JSON.stringify(consoleErrs).slice(0, 300))
} finally {
  await browser.close()
}

const passed = results.filter((r) => r.ok).length
const out = results.map((r) => (r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '   >> ' + r.extra))
out.push('', 'RESULT passed ' + passed + '/' + results.length + '  (phase=' + PHASE + ')')
if (passed !== results.length) { out.push('FAILED:'); for (const r of results.filter((x) => !x.ok)) out.push('  - ' + r.name + ' >> ' + r.extra) }
writeFileSync(join(SHOTS, 'result-' + PHASE + '.txt'), out.join('\n') + '\n')
console.log(out.join('\n'))
process.exitCode = passed === results.length ? 0 : 1
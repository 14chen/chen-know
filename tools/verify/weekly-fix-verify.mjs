/* 409 语义修正 + 预留 notesSkipped 验收 */
import { launch } from './cdp.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const BASE = arg('--base', 'http://127.0.0.1:8096')
const PHASE = arg('--phase', 'states')
const SHOTS = fileURLToPath(new URL('./weekly-shots/', import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, extra) => { results.push({ n, ok: !!ok, extra: String(extra === undefined ? '' : extra).slice(0, 400) }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '   >> ' + String(extra).slice(0, 400))) }
mkdirSync(SHOTS, { recursive: true })
const browser = await launch()
const page = await browser.newPage(BASE + '/')
const ev = (e) => page.eval(e)
const runBtn = 'Array.prototype.find.call(document.querySelectorAll("button"),function(b){return /一键获取本周周报|正在获取/.test(b.textContent)})'
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
  await ev('location.hash = "#/weekly"')
  await page.waitFor('document.querySelector(".vw-weekly__section") !== null', { timeout: 30000 })
  await sleep(1500)
  if (PHASE === 'first') {
    // 前置：由外面清空周目录；这里再确认一次「本周项目 0 张卡」
    const before = await ev('document.querySelectorAll(".vw-weekly__card:not(.vw-weekly__card--skeleton)").length')
    check('[0] 前置：周目录已空（0 张卡片）', Number(before) === 0, 'cards=' + before)
    await ev(runBtn + '.click()')
    await page.waitFor('document.querySelector(".vw-weekly__strip.is-success, .vw-weekly__strip.is-warning, .vw-weekly__strip.is-error, .vw-weekly__strip.is-info:not(.is-loading)") !== null', { timeout: 150000 })
    await sleep(800)
    const s1 = await ev('(function(){var s=document.querySelector(".vw-weekly__strip");return JSON.stringify({cls:s.className,text:s.textContent.trim()})})()')
    const f1 = JSON.parse(s1)
    console.log('      [1] ' + f1.cls + ' | ' + f1.text)
    check('[1] created>0：绿条 + 已生成 N 篇（GitHub a · Gitee b）+ 查看本周项目', /is-success/.test(f1.cls) && /已生成 \d+ 篇（GitHub \d+ · Gitee \d+）/.test(f1.text) && /查看本周项目/.test(f1.text), s1)
    await page.screenshot(join(SHOTS, 'fix-green-created.png'))
  }
  if (PHASE === 'states') {
    await ev(runBtn + '.click()')
    await page.waitFor('document.querySelector(".vw-weekly__strip.is-success, .vw-weekly__strip.is-error, .vw-weekly__strip.is-warning, .vw-weekly__strip.is-info:not(.is-loading)") !== null', { timeout: 120000 })
    await sleep(700)
    const s1 = await ev('(function(){var s=document.querySelector(".vw-weekly__strip");return JSON.stringify({cls:s.className,text:s.textContent.trim()})})()')
    const f1 = JSON.parse(s1);
    console.log('      [1] ' + f1.cls + ' | ' + f1.text);
    check('[1] created>0：绿条 + 已生成 N 篇（GitHub a · Gitee b）', /is-success/.test(f1.cls) && /已生成 \d+ 篇（GitHub \d+ · Gitee \d+）/.test(f1.text) && /查看本周项目/.test(f1.text), s1)
    await page.screenshot(join(SHOTS, 'fix-green-created.png'))
    await ev(runBtn + '.click()')
    await page.waitFor('document.querySelector(".vw-weekly__strip.is-info:not(.is-loading)") !== null', { timeout: 120000 })
    await sleep(700)
    const s2 = await ev('(function(){var s=document.querySelector(".vw-weekly__strip");return JSON.stringify({cls:s.className,text:s.textContent.trim(),btns:s.querySelectorAll("button").length,red:!!document.querySelector(".vw-weekly__strip.is-error"),green:!!document.querySelector(".vw-weekly__strip.is-success")})})()')
    const f2 = JSON.parse(s2);
    console.log('      [2] ' + f2.cls + ' | ' + f2.text);
    check('[2] created=0 且 skipped>0：蓝条「本周周报已存在，M 篇跳过未重复生成」', /is-info/.test(f2.cls) && /本周周报已存在，\d+ 篇跳过未重复生成/.test(f2.text), s2)
    check('[2] 蓝条不是错误色、也不是绿条，且带「查看本周项目」', f2.red === false && f2.green === false && /查看本周项目/.test(f2.text), s2)
    await page.screenshot(join(SHOTS, 'fix-blue-exists.png'))
    await ev('(function(){ window.__run1 = fetch("/api/weekly/run",{method:"POST"}); return true })()')
    await sleep(400)
    await ev(runBtn + '.click()')
    await page.waitFor('document.querySelector(".vw-weekly__strip.is-warning") !== null', { timeout: 40000 })
    await sleep(900)
    const s3 = await ev('(function(){var s=document.querySelector(".vw-weekly__strip");return JSON.stringify({cls:s.className,text:s.textContent.trim(),btns:s.querySelectorAll("button").length,modals:document.querySelectorAll(".kb-modal").length})})()')
    const f3 = JSON.parse(s3);
    console.log('      [3] ' + f3.cls + ' | ' + f3.text + ' | buttons=' + f3.btns + ' modals=' + f3.modals);
    check('[3] 409：黄条「正在生成中…（约 15–40 秒）后再点」', /is-warning/.test(f3.cls) && /正在生成中/.test(f3.text) && /15–40 秒/.test(f3.text), s3)
    check('[3] 409：提示条里没有按钮（不给重试）', f3.btns === 0, s3)
    check('[3] 409：没有弹 ctx.confirm（无 .kb-modal）', f3.modals === 0, s3)
    await page.screenshot(join(SHOTS, 'fix-yellow-409.png'))
    await page.waitFor('document.querySelector(".vw-weekly__table tbody tr") !== null', { timeout: 30000 })
    await sleep(500)
    const cells = JSON.parse(await ev('JSON.stringify(Array.prototype.map.call(document.querySelectorAll(".vw-weekly__table tbody tr"),function(tr){return tr.children[3].textContent.trim()}))'))
    void cells
  }
  if (PHASE === 'skipped' || PHASE === 'noskip') {
    await page.waitFor('document.querySelector(".vw-weekly__table tbody tr") !== null', { timeout: 30000 })
    await sleep(700)
    const cells = JSON.parse(await ev('JSON.stringify(Array.prototype.map.call(document.querySelectorAll(".vw-weekly__table tbody tr"),function(tr){return tr.children[3].textContent.trim()}))'))
    if (PHASE === 'skipped') {
      check('[4a] 运行历史：notesSkipped 有值时显示数字', cells.length > 0 && cells.every((t) => /^\d+$/.test(t)), JSON.stringify(cells))
      await page.screenshot(join(SHOTS, 'fix-runs-skipped.png'))
    } else {
      check('[4b] 运行历史：没有 notesSkipped 字段时显示「—」', cells.length > 0 && cells.every((t) => t === '—'), JSON.stringify(cells))
      await page.screenshot(join(SHOTS, 'fix-runs-noskip.png'))
    }
  }
  for (const s of [[1440, 900], [1180, 800], [900, 700], [390, 844]]) {
    await page.setViewport(s[0], s[1])
    await sleep(700)
    const ov = JSON.parse(await ev('JSON.stringify({doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})'))
    check('周报 @' + s[0] + '：无横向溢出', ov.doc <= ov.client, JSON.stringify(ov))
  }
  const errs = await page.consoleErrors()
  check('页面无 console 错误', errs.length === 0, JSON.stringify(errs).slice(0, 200))
} finally { await browser.close() }
const passed = results.filter((r) => r.ok).length
const out = results.map((r) => (r.ok ? 'PASS  ' : 'FAIL  ') + r.n + (r.ok ? '' : '   >> ' + r.extra))
out.push('', 'RESULT passed ' + passed + '/' + results.length + '  (phase=' + PHASE + ')')
if (passed !== results.length) { out.push('FAILED:'); for (const r of results.filter((x) => !x.ok)) out.push('  - ' + r.n + ' >> ' + r.extra) }
writeFileSync(join(SHOTS, 'result-fix-' + PHASE + '.txt'), out.join('\n') + '\n')
console.log(out.join('\n'))
process.exitCode = passed === results.length ? 0 : 1
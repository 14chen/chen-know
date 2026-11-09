import { launch } from './cdp.mjs'
import { statSync } from 'node:fs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const APP = 'http://127.0.0.1:8090'
const OUT = 'D:/deepseekhums/work/知识库/docs/images'
const b = await launch({ width: 1416, height: 808, scale: 2 })
const done = []
const note = (f) => { const p = OUT + '/' + f; try { done.push(f); console.log('  OK   ' + f.padEnd(30) + statSync(p).size + ' B') } catch { console.log('  MISS ' + f) } }
try {
  const p = await b.newPage(APP + '/')
  await p.waitForLoad(); await sleep(1500)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,'demo'); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,'DemoPass123!'); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2500)

  // 1) 主界面（侧栏现在有「关系图」）
  await p.goto(APP + '/#/notes/1', { waitMs: 2500 }); await sleep(2000)
  await p.screenshot(OUT + '/03-主界面-标注.png'); note('03-主界面-标注.png')

  // 2) 搜索（现在有筛选条 + 片段）
  await p.goto(APP + '/#/search?q=权限', { waitMs: 2200 }); await sleep(2500)
  const s1 = await p.eval("(() => { const t = document.body.innerText; return JSON.stringify({ hasFilter: /目录|标签|排序/.test(t), hasSnippet: /命中|条/.test(t), n: (t.match(/共 \\d+ 条/) || [''])[0] }); })()")
  console.log('  搜索页状态:', s1)
  await p.screenshot(OUT + '/07-搜索-标注.png'); note('07-搜索-标注.png')

  // 3) 关系图
  await p.goto(APP + '/#/graph', { waitMs: 2200 }); await sleep(4500)
  const g = await p.eval("(() => { const s = document.querySelector('.vw-graph__svg'); if (!s) return 'no svg'; return s.querySelectorAll('circle').length + ' circles / ' + s.querySelectorAll('line').length + ' lines'; })()")
  console.log('  关系图:', g)
  await p.screenshot(OUT + '/20-关系图.png'); note('20-关系图.png')
} catch (e) { console.error('异常: ' + e.message) } finally { await b.close() }
console.log('完成 ' + done.length + ' 张')
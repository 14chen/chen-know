import { launch } from './cdp.mjs'
import { statSync } from 'node:fs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const APP = 'http://127.0.0.1:8090'
const OUT = 'D:/deepseekhums/work/知识库/docs/images'
const b = await launch({ width: 1416, height: 808, scale: 2 })
try {
  const p = await b.newPage(APP + '/')
  await p.waitForLoad(); await sleep(1500)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,'demo'); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,'DemoPass123!'); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2500)
  await p.goto(APP + '/#/search?q=' + encodeURIComponent('笔记'), { waitMs: 2200 }); await sleep(3000)
  const st = await p.eval("(() => { const t = document.body.innerText; const m = t.match(/共 (\\d+) 条/); const strongs = document.querySelectorAll('strong').length; return JSON.stringify({ total: m ? m[1] : '?', strongs, 有筛选: /目录/.test(t) }); })()")
  console.log('  搜索页:', st)
  await p.screenshot(OUT + '/07-搜索-标注.png')
  console.log('  07-搜索-标注.png  ' + statSync(OUT + '/07-搜索-标注.png').size + ' B')
} catch (e) { console.error('异常: ' + e.message) } finally { await b.close() }
import { launch } from './cdp.mjs'
import { statSync } from 'node:fs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const OUT = 'D:/deepseekhums/work/知识库/docs/images'
const b = await launch({ width: 390, height: 844, scale: 2 })
try {
  const p = await b.newPage('http://127.0.0.1:8090/')
  await p.waitForLoad(); await sleep(1200)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,'demo'); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,'DemoPass123!'); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2500)
  const before = await p.eval("(() => { const s=document.querySelector('.kb-sidebar'); const r=s.getBoundingClientRect(); return Math.round(r.x) + '/' + Math.round(r.width); })()")
  console.log('点击前 侧栏 x/宽:', before)
  const clicked = await p.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='收起左栏' || (x.title||'')==='收起左栏'); if(!b) return 'none'; b.click(); return 'clicked'; })()")
  console.log('点击结果:', clicked)
  await sleep(1400)
  const after = await p.eval("(() => { const s=document.querySelector('.kb-sidebar'); const r=s.getBoundingClientRect(); return Math.round(r.x) + '/' + Math.round(r.width); })()")
  console.log('点击后 侧栏 x/宽:', after)
  await p.screenshot(OUT + '/17-手机-侧栏抽屉.png')
  console.log('  17-手机-侧栏抽屉.png  ' + statSync(OUT + '/17-手机-侧栏抽屉.png').size + ' B')

  // 关掉抽屉再拍编辑器，保证 16 与 17 不同
  await p.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='收起左栏' || (x.title||'')==='收起左栏'); if(b) b.click(); })()")
  await sleep(1200)
  const after2 = await p.eval("(() => { const s=document.querySelector('.kb-sidebar'); const r=s.getBoundingClientRect(); return Math.round(r.x); })()")
  console.log('再点后 侧栏 x:', after2)
  await p.goto('http://127.0.0.1:8090/#/notes/5', { waitMs: 2200 }); await sleep(1600)
  await p.screenshot(OUT + '/16-手机-编辑器.png')
  console.log('  16-手机-编辑器.png  ' + statSync(OUT + '/16-手机-编辑器.png').size + ' B')
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
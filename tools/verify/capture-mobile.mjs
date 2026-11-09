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
  const x0 = await p.eval("Math.round(document.querySelector('.kb-sidebar').getBoundingClientRect().x)")
  console.log('抽屉打开前 侧栏 x:', x0)
  await p.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='打开菜单'); if(b) b.click(); })()")
  await sleep(1500)
  const x1 = await p.eval("Math.round(document.querySelector('.kb-sidebar').getBoundingClientRect().x)")
  console.log('抽屉打开后 侧栏 x:', x1)
  await p.screenshot(OUT + '/17-手机-侧栏抽屉.png')
  console.log('  17-手机-侧栏抽屉.png  ' + statSync(OUT + '/17-手机-侧栏抽屉.png').size + ' B')

  await p.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='打开菜单'); if(b) b.click(); })()")
  await sleep(1000)
  await p.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='打开搜索'); if(b) b.click(); })()")
  await sleep(1600)
  console.log('  搜索框可见:', await p.eval("(() => { const i=[...document.querySelectorAll('input')].find(x=>/搜索/.test(x.placeholder||'')); return i ? '是' : '否'; })()"))
  await p.screenshot(OUT + '/18-手机-搜索.png')
  console.log('  18-手机-搜索.png  ' + statSync(OUT + '/18-手机-搜索.png').size + ' B')

  await p.goto('http://127.0.0.1:8090/#/notes/5', { waitMs: 2200 }); await sleep(1600)
  await p.screenshot(OUT + '/16-手机-编辑器.png')
  console.log('  16-手机-编辑器.png  ' + statSync(OUT + '/16-手机-编辑器.png').size + ' B')
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
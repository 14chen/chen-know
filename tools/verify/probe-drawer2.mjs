import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
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
  console.log('kb-app class:', await p.eval("document.querySelector('.kb-app') ? document.querySelector('.kb-app').className : '无'"))
  console.log('sidebar class:', await p.eval("document.querySelector('.kb-sidebar') ? document.querySelector('.kb-sidebar').className : '无'"))
  console.log('topbar 内容:', await p.eval("(() => { const t=document.querySelector('.kb-topbar') || document.querySelector('header'); if(!t) return '无 topbar'; return t.className + ' :: ' + [...t.querySelectorAll('button')].map(b=>(b.getAttribute('aria-label')||b.title||b.className)).join(' | '); })()"))
  console.log('所有 aria-label:', await p.eval("JSON.stringify([...document.querySelectorAll('[aria-label]')].map(e=>e.tagName+':'+e.getAttribute('aria-label')).slice(0,25))"))
} finally { await b.close() }
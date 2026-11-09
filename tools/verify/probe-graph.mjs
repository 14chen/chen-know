import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const APP = 'http://127.0.0.1:8090'
const b = await launch({ width: 1440, height: 900, scale: 1 })
try {
  const p = await b.newPage(APP + '/')
  await p.waitForLoad(); await sleep(1500)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,'pwa'); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,'PwaPass1234!'); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2500)
  await p.goto(APP + '/#/graph', { waitMs: 2000 })
  await sleep(6000)
  console.log('hash:', await p.eval('location.hash'))
  console.log('页面文本:', String(await p.eval('document.body.innerText')).replace(/\n+/g,' | ').slice(0, 400))
  console.log('svg 数量:', await p.eval("document.querySelectorAll('svg').length"))
  console.log('svg 里元素类型统计:', await p.eval("(() => { const s=document.querySelector('svg'); if(!s) return 'none'; const m={}; s.querySelectorAll('*').forEach(e=>{m[e.tagName]=(m[e.tagName]||0)+1}); return JSON.stringify(m); })()"))
  console.log('console 错误:', JSON.stringify(await p.consoleErrors()).slice(0, 400))
  // 直接问接口
  console.log('接口 /api/notes?size=200:', await p.eval("fetch('/api/notes?size=200').then(r=>r.status + ' ' + 'ok')"))
  console.log('笔记数:', await p.eval("fetch('/api/notes?size=200').then(r=>r.json()).then(j => j.items ? j.items.length : 'no items')"))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
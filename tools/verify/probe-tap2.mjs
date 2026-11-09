import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const APP = 'http://127.0.0.1:8090'
const b = await launch({ width: 390, height: 844, scale: 1 })
try {
  const p = await b.newPage(APP + '/')
  await p.waitForLoad(); await sleep(1500)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,\"demo\"); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,\"DemoPass123!\"); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2500)
  console.log('innerWidth:', await p.eval('window.innerWidth'))
  console.log('媒体查询 (width<=1023px) 是否匹配:', await p.eval("window.matchMedia('(width<=1023px)').matches"))
  console.log('媒体查询 (max-width:1023px) 是否匹配:', await p.eval("window.matchMedia('(max-width:1023px)').matches"))
  console.log('.kb-tree-row__main 计算样式:', await p.eval("(() => { const e=document.querySelector('.kb-tree-row__main'); if(!e) return 'none'; const s=getComputedStyle(e); const r=e.getBoundingClientRect(); return JSON.stringify({ h: Math.round(r.height), minH: s.minHeight, height: s.height, display: s.display, flex: s.flex }) })()"))
  console.log('.kb-note-item__main 计算样式:', await p.eval("(() => { const e=document.querySelector('.kb-note-item__main'); if(!e) return 'none'; const s=getComputedStyle(e); const r=e.getBoundingClientRect(); return JSON.stringify({ h: Math.round(r.height), minH: s.minHeight }) })()"))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
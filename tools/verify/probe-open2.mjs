import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const APP = 'http://127.0.0.1:8090'
const b = await launch({ width: 1440, height: 900, scale: 1 })
try {
  const p = await b.newPage(APP + '/')
  await p.waitForLoad(); await sleep(1500)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,\"demo\"); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,\"DemoPass123!\"); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(3000)
  console.log('登录后 hash:', await p.eval('location.hash'))
  const ok = await p.eval("(() => { const t='双向链接演示（A）'; const el=[...document.querySelectorAll('*')].find(e => (e.textContent||'').trim()===t && e.children.length===0); if(!el) return 'notfound'; el.click(); return 'clicked' })()")
  console.log('点击结果:', ok)
  await sleep(1800)
  console.log('点击后 hash:', await p.eval('location.hash'))
  console.log('chip 数（此时）:', await p.eval("document.querySelectorAll('.cm-content .cm-kb-chip').length"))
  const n = await p.eval("document.querySelectorAll('.cm-line').length")
  console.log('行数:', n)
  // 模拟 clickLine 到最后一行
  await p.eval('(() => { const ls=[...document.querySelectorAll(".cm-line")]; const last=ls[ls.length-1]; const r=last.getBoundingClientRect(); last.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:r.x+20,clientY:r.y+r.height/2})); })()')
  await sleep(700)
  console.log('点最后一行后 chip 数:', await p.eval("document.querySelectorAll('.cm-content .cm-kb-chip').length"))
  console.log('最后一行文本:', await p.eval("(() => { const ls=[...document.querySelectorAll('.cm-line')]; return ls[ls.length-1].textContent.slice(0,80) })()"))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
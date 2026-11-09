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
  console.log(await p.eval("(() => { const out=[]; document.querySelectorAll('*').forEach(e => { const t=(e.textContent||'').trim(); if (t==='全部笔记') { const r=e.getBoundingClientRect(); if (r.width>0) out.push(Math.round(r.width)+'x'+Math.round(r.height)+' <'+e.tagName+'.'+String(e.className)+'>') } }); return out.join('\\n') })()"))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
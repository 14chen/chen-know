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
  await sleep(2500)
  await p.goto(APP + '/#/notes/3', { waitMs: 2500 }); await sleep(3000)
  console.log('=== 编辑器里含 [[ 的行 ===')
  console.log(await p.eval("(() => { const lines=[...document.querySelectorAll('.cm-line')]; const hit=lines.filter(l=>l.textContent.includes('[[')); return hit.map(l=>l.className + ' :: ' + l.textContent.slice(0,70)).join('\\n') || '没有含[[的行'; })()"))
  console.log('=== 所有 cm-* 类名统计 ===')
  console.log(await p.eval("(() => { const m={}; document.querySelectorAll('[class*=cm-]').forEach(e=>{String(e.className).split(/\\s+/).forEach(c=>{if(c.startsWith('cm-kb')) m[c]=(m[c]||0)+1})}); return JSON.stringify(m); })()"))
  console.log('=== console 错误 ===')
  console.log(JSON.stringify(await p.consoleErrors()).slice(0, 500))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
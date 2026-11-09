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
  await p.goto(APP + '/#/notes/3', { waitMs: 2500 }); await sleep(3500)
  console.log('全文档 .cm-kb-chip      :', await p.eval("document.querySelectorAll('.cm-kb-chip').length"))
  console.log('.cm-content .cm-kb-chip :', await p.eval("document.querySelectorAll('.cm-content .cm-kb-chip').length"))
  console.log('.cm-editor .cm-kb-chip  :', await p.eval("document.querySelectorAll('.cm-editor .cm-kb-chip').length"))
  console.log('cm-content 是否存在      :', await p.eval("document.querySelectorAll('.cm-content').length"))
  console.log('chip 的祖先链:', await p.eval("(() => { const c = document.querySelector('.cm-kb-chip'); if(!c) return 'none'; const out=[]; let e=c; for(let i=0;i<6&&e;i++){ out.push(e.tagName + '.' + String(e.className).slice(0,40)); e=e.parentElement } return out.join(' > '); })()"))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
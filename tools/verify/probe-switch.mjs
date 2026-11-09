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
  const go = async (id) => { await p.eval("location.hash = '#/notes/' + " + id); await sleep(2200) }
  await go(2); console.log('到 note2 hash =', await p.eval('location.hash'))
  // 模拟测试的 clickLine 最后一行
  await p.eval('(() => { const ls=[...document.querySelectorAll(".cm-line")]; const last=ls[ls.length-1]; const r=last.getBoundingClientRect(); last.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,clientX:r.x+20,clientY:r.y+8})); last.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,clientX:r.x+20,clientY:r.y+8})); })()')
  await sleep(800)
  console.log('点完最后一行，准备切 note3…')
  await go(3)
  console.log('切到 note3 后 hash =', await p.eval('location.hash'))
  console.log('console 错误:', JSON.stringify((await p.consoleErrors()).slice(0,6)).slice(0,600))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
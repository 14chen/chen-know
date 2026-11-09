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
  await p.goto(APP + '/#/graph', { waitMs: 2000 }); await sleep(5000)
  console.log('===== 带 vw-graph 的元素 =====')
  console.log(await p.eval("JSON.stringify([...document.querySelectorAll('[class*=vw-graph]')].map(e => e.tagName + '.' + String(e.className).slice(0,60)).slice(0,10))")
  )
  console.log('===== 所有 svg 及其 circle 数 =====')
  console.log(await p.eval("JSON.stringify([...document.querySelectorAll('svg')].map((s,i) => i + ':' + String(s.className.baseVal||s.getAttribute('class')||'(no class)').slice(0,40) + ' circles=' + s.querySelectorAll('circle').length))")
  )
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
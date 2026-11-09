import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const APP = 'http://127.0.0.1:8090'
const TITLE = '双向链接演示（A）'
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
  const T = JSON.stringify(TITLE)
  console.log('叶子完全匹配的元素数:', await p.eval("(() => { const t=" + T + "; return [...document.querySelectorAll('*')].filter(e => (e.textContent||'').trim()===t && e.children.length===0).length })()"))
  console.log('包含该标题的元素数  :', await p.eval("(() => { const t=" + T + "; return [...document.querySelectorAll('*')].filter(e => (e.textContent||'').trim()===t).length })()"))
  console.log('列表项结构:', await p.eval("(() => { const t=" + T + "; const el=[...document.querySelectorAll('*')].find(e => (e.textContent||'').trim()===t); if(!el) return '找不到'; const out=[]; let e=el; for(let i=0;i<5&&e;i++){ out.push(e.tagName+'.'+String(e.className).slice(0,34)+' children='+e.children.length); e=e.parentElement } return out.join(' > ') })()"))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
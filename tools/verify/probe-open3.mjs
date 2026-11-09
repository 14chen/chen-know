import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const APP = 'http://127.0.0.1:8090'
const b = await launch({ width: 1440, height: 900, scale: 1 })
const openNote = async (p, title) => {
  const r = await p.eval("(() => { const t=" + JSON.stringify(title) + "; const all=[...document.querySelectorAll('*')].filter(e => (e.textContent||'').trim()===t && e.children.length===0); if(!all.length) return 'notfound'; const el=all[0]; el.click(); return 'clicked:' + all.length + ':' + el.tagName + '.' + String(el.className).slice(0,40) })()")
  await sleep(1800)
  return r
}
try {
  const p = await b.newPage(APP + '/')
  await p.waitForLoad(); await sleep(1500)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,\"demo\"); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,\"DemoPass123!\"); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2500)
  console.log('A) 打开 Markdown 速查:', await openNote(p, 'Markdown 速查'), 'hash=', await p.eval('location.hash'))
  console.log('   chip 数:', await p.eval("document.querySelectorAll('.cm-content .cm-kb-chip').length"))
  console.log('B) 打开 双向链接演示（A）:', await openNote(p, '双向链接演示（A）'), 'hash=', await p.eval('location.hash'))
  console.log('   chip 数:', await p.eval("document.querySelectorAll('.cm-content .cm-kb-chip').length"))
  console.log('   标题栏文本:', await p.eval("(() => { const e=document.querySelector('.kb-note-title, .kb-title, h1'); return e ? e.textContent.trim().slice(0,40) : 'none' })()"))
  console.log('   正文首行:', await p.eval("(() => { const l=document.querySelector('.cm-line'); return l ? l.textContent.slice(0,50) : 'none' })()"))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
import { launch } from './cdp.mjs'
import { statSync } from 'node:fs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const OUT = 'D:/deepseekhums/work/知识库/docs/images'
const b = await launch({ width: 1416, height: 808, scale: 2 })
try {
  const p = await b.newPage('http://127.0.0.1:8090/')
  await p.waitForLoad(); await sleep(1200)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,'demo'); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,'DemoPass123!'); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2200)
  // 新建空笔记，保证输入区是干净的
  const created = await p.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='新建笔记'); if(!b) return 'none'; b.click(); return 'clicked'; })()")
  console.log('新建笔记按钮:', created)
  await sleep(2600)
  console.log('编辑器就绪:', await p.eval("!!document.querySelector('.cm-content')"))
  console.log('输入前文本:', JSON.stringify(await p.eval("(() => { const c=document.querySelector('.cm-content'); return c ? c.textContent.slice(0,40) : '无'; })()")))
  // 点进编辑区
  const pos = await p.eval("(() => { const c=document.querySelector('.cm-content'); const r=c.getBoundingClientRect(); return (r.x + 30) + ',' + (r.y + 20); })()")
  const xy = pos.split(',')
  await p.clickAt(parseFloat(xy[0]), parseFloat(xy[1])); await sleep(600)
  for (const ch of ['[','[']) {
    await p._send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
    await p._send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(500)
  }
  await sleep(1800)
  console.log('输入后文本:', JSON.stringify(await p.eval("(() => { const c=document.querySelector('.cm-content'); return c ? c.textContent.slice(0,40) : '无'; })()")))
  console.log('弹窗:', await p.eval("(() => { const t=document.querySelector('.cm-tooltip-autocomplete'); return t ? ('候选 ' + t.querySelectorAll('li').length + ' 条') : '无'; })()"))
  await p.screenshot(OUT + '/06-输入两个方括号弹出候选.png')
  console.log('  ' + statSync(OUT + '/06-输入两个方括号弹出候选.png').size + ' B')
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
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
  await p.goto('http://127.0.0.1:8090/#/notes/1', { waitMs: 2500 }); await sleep(1800)
  // 点到正文最后一行末尾，确保光标在行尾且前面没有残留字符
  const pos = await p.eval("(() => { const ls=document.querySelectorAll('.cm-line'); const el=ls[ls.length-1]; const r=el.getBoundingClientRect(); return (r.x + r.width*0.15) + ',' + (r.y + r.height/2); })()")
  const xy = pos.split(',')
  await p.clickAt(parseFloat(xy[0]), parseFloat(xy[1])); await sleep(600)
  await p.press('End'); await sleep(300)
  await p.press('Enter'); await sleep(400)
  console.log('输入前该行文本:', JSON.stringify(await p.eval("(() => { const ls=document.querySelectorAll('.cm-line'); return ls[ls.length-1].textContent; })()")))
  for (const ch of ['[','[']) {
    await p._send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
    await p._send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(450)
  }
  await sleep(1800)
  console.log('输入后该行文本:', JSON.stringify(await p.eval("(() => { const ls=document.querySelectorAll('.cm-line'); return ls[ls.length-1].textContent; })()")))
  console.log('弹窗:', await p.eval("(() => { const t=document.querySelector('.cm-tooltip-autocomplete'); return t ? ('候选 ' + t.querySelectorAll('li').length + ' 条') : '无'; })()"))
  await p.screenshot(OUT + '/06-输入两个方括号弹出候选.png')
  console.log('  06 重拍完成 ' + statSync(OUT + '/06-输入两个方括号弹出候选.png').size + ' B')
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
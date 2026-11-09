import { launch } from './cdp.mjs'
import { existsSync, statSync } from 'node:fs'
const APP = 'http://127.0.0.1:8090'
const OUT = 'D:/deepseekhums/work/知识库/docs/images'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const done = []
function note(f) { const p = OUT + '/' + f; const ok = existsSync(p); done.push(f); console.log('  ' + (ok ? 'OK  ' : 'MISS') + ' ' + f + '  ' + (ok ? statSync(p).size + ' B' : '')) }
const b = await launch({ width: 1440, height: 900 })
try {
  const p = await b.newPage(APP + '/')
  await p.waitForLoad(); await sleep(1500)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,'demo'); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,'DemoPass123!'); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2200)
  console.log('  已登录')

  await p.goto(APP + '/#/notes/5', { waitMs: 2500 }); await sleep(1500)
  const info = await p.eval("(() => { const ls=document.querySelectorAll('.cm-line'); const el=ls[ls.length-2]||ls[0]; const r=el.getBoundingClientRect(); return r.x + ',' + (r.y + r.height/2); })()")
  const xy = info.split(',')
  await p.clickAt(parseFloat(xy[0]) + 20, parseFloat(xy[1])); await sleep(500)
  for (const ch of [']','[','[']) {
    await p._send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
    await p._send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(400)
  }
  await sleep(1800)
  console.log('  弹窗状态:', await p.eval("(() => { const t=document.querySelector('.cm-tooltip-autocomplete'); return t ? ('有候选 ' + t.querySelectorAll('li').length + ' 条') : '无弹窗'; })()"))
  await p.screenshot(OUT + '/06-输入两个方括号弹出候选.png'); note('06-输入两个方括号弹出候选.png')

  await p.goto(APP + '/#/backlinks', { waitMs: 2500 }); await sleep(1600)
  await p.screenshot(OUT + '/09-反向链接.png'); note('09-反向链接.png')

  await p.goto(APP + '/#/io', { waitMs: 2500 }); await sleep(1800)
  await p.screenshot(OUT + '/12-导入导出.png'); note('12-导入导出.png')

  await p.goto(APP + '/#/stats', { waitMs: 2500 }); await sleep(1800)
  await p.screenshot(OUT + '/13-统计.png'); note('13-统计.png')

  await p.goto(APP + '/#/notes/5', { waitMs: 2500 }); await sleep(1500)
  console.log('  主题按钮:', await p.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>/主题/.test(x.getAttribute('aria-label')||'')); if(!b) return 'none'; b.click(); return 'clicked'; })()"))
  await sleep(1400)
  console.log('  主题:', await p.eval("document.documentElement.getAttribute('data-theme')"))
  await p.screenshot(OUT + '/15-深色主题.png'); note('15-深色主题.png')
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
console.log('捕获:', done.length, '张')
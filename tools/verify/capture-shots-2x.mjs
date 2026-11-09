import { launch } from './cdp.mjs'
import { existsSync, statSync } from 'node:fs'
const APP = 'http://127.0.0.1:8090'
const OUT = 'D:/deepseekhums/work/知识库/docs/images'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const S = 2
const done = []
function note(f) { const p = OUT + '/' + f; const ok = existsSync(p); done.push(f); console.log('  ' + (ok ? 'OK  ' : 'MISS') + f.padEnd(34) + (ok ? statSync(p).size + ' B' : '')) }
async function doLogin(p) {
  await p.waitForLoad(); await sleep(1200)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,'demo'); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,'DemoPass123!'); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2200)
}

// ---- 桌面 1416x808 @2x ----
const b1 = await launch({ width: 1416, height: 808, scale: S })
try {
  const p = await b1.newPage(APP + '/')
  await p.waitForLoad(); await sleep(2200)
  await p.screenshot(OUT + '/02-登录页.png'); note('02-登录页.png')
  await doLogin(p)
  await p.goto(APP + '/#/notes/5', { waitMs: 2500 }); await sleep(1600)
  const info = await p.eval("(() => { const ls=document.querySelectorAll('.cm-line'); const el=ls[ls.length-2]||ls[0]; const r=el.getBoundingClientRect(); return r.x + ',' + (r.y + r.height/2); })()")
  const xy = info.split(',')
  await p.clickAt(parseFloat(xy[0]) + 20, parseFloat(xy[1])); await sleep(500)
  for (const ch of [']','[','[']) {
    await p._send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
    await p._send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(400)
  }
  await sleep(1800)
  console.log('  弹窗:', await p.eval("(() => { const t=document.querySelector('.cm-tooltip-autocomplete'); return t ? ('候选 ' + t.querySelectorAll('li').length + ' 条') : '无'; })()"))
  await p.screenshot(OUT + '/06-输入两个方括号弹出候选.png'); note('06-输入两个方括号弹出候选.png')
  await p.goto(APP + '/#/backlinks', { waitMs: 2500 }); await sleep(1600)
  await p.screenshot(OUT + '/09-反向链接.png'); note('09-反向链接.png')
  await p.goto(APP + '/#/io', { waitMs: 2500 }); await sleep(1800)
  await p.screenshot(OUT + '/12-导入导出.png'); note('12-导入导出.png')
  await p.goto(APP + '/#/stats', { waitMs: 2500 }); await sleep(1800)
  await p.screenshot(OUT + '/13-统计.png'); note('13-统计.png')
  await p.goto(APP + '/#/notes/5', { waitMs: 2500 }); await sleep(1500)
  await p.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>/主题/.test(x.getAttribute('aria-label')||'')); if(b) b.click(); })()")
  await sleep(1500)
  console.log('  主题:', await p.eval("document.documentElement.getAttribute('data-theme')"))
  await p.screenshot(OUT + '/15-深色主题.png'); note('15-深色主题.png')
} catch (e) { console.error('桌面组异常:', e.message) } finally { await b1.close() }

// ---- 平板 900x700 @2x ----
const b2 = await launch({ width: 900, height: 700, scale: S })
try {
  const p = await b2.newPage(APP + '/')
  await doLogin(p)
  await p.goto(APP + '/#/notes/5', { waitMs: 2500 }); await sleep(1800)
  await p.screenshot(OUT + '/19-平板-编辑器.png'); note('19-平板-编辑器.png')
} catch (e) { console.error('平板组异常:', e.message) } finally { await b2.close() }

// ---- 手机 390x844 @2x ----
const b3 = await launch({ width: 390, height: 844, scale: S })
try {
  const p = await b3.newPage(APP + '/')
  await doLogin(p)
  await p.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>/侧栏|菜单|目录/.test((x.getAttribute('aria-label')||'')+(x.title||''))); if(b) b.click(); })()")
  await sleep(1300)
  await p.screenshot(OUT + '/17-手机-侧栏抽屉.png'); note('17-手机-侧栏抽屉.png')
  await p.goto(APP + '/#/search', { waitMs: 2000 }); await sleep(1500)
  await p.screenshot(OUT + '/18-手机-搜索.png'); note('18-手机-搜索.png')
  await p.goto(APP + '/#/notes/5', { waitMs: 2200 }); await sleep(1500)
  await p.screenshot(OUT + '/16-手机-编辑器.png'); note('16-手机-编辑器.png')
} catch (e) { console.error('手机组异常:', e.message) } finally { await b3.close() }
console.log('完成 ' + done.length + ' 张')
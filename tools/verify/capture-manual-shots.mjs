import { launch } from './cdp.mjs'
import { existsSync, mkdirSync, statSync } from 'node:fs'
const APP = process.argv[2] || 'http://127.0.0.1:8090'
const OUT = process.argv[3] || 'D:/deepseekhums/work/知识库/docs/images'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

async function login(p) {
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,'demo'); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,'DemoPass123!'); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2200)
}

const results = []
function note(file, w, h) {
  const p = OUT + '/' + file
  const ok = existsSync(p)
  results.push({ file, ok, bytes: ok ? statSync(p).size : 0, size: w + 'x' + h })
  console.log('  ' + (ok ? 'OK  ' : 'MISS') + ' ' + file + '  ' + (ok ? statSync(p).size + ' B' : ''))
}

// ---- 桌面 1440x900 组 ----
const b1 = await launch({ width: 1440, height: 900 })
try {
  // 1) 登录页
  const p = await b1.newPage(APP + '/')
  await p.waitForLoad(); await sleep(2000)
  await p.screenshot(OUT + '/02-登录页.png')
  note('02-登录页.png', 1440, 900)

  await login(p)

  // 2) [[ 候选
  await p.goto(APP + '/#/notes/5', { waitMs: 2500 })
  await sleep(1500)
  const lineInfo = await p.eval("(() => { const ls=document.querySelectorAll('.cm-line'); const el=ls[ls.length-1]; const r=el.getBoundingClientRect(); return JSON.stringify({x:r.x+40,y:r.y+r.height/2}); })()")
  const pt = JSON.parse(lineInfo)
  await p.clickAt(pt.x, pt.y); await sleep(400)
  await p.eval("window.__kbEnd = document.querySelector('.cm-content'); true")
  for (const ch of ['ArrowDown','Enter']) { await p.press(ch); await sleep(120) }
  for (const ch of ['ArrowDown','ArrowDown','ArrowDown','ArrowDown','ArrowDown']) { await p.press(ch); await sleep(90) }
  for (const ch of ['[','[']) {
    await p._send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
    await p._send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(350)
  }
  await sleep(1500)
  const popup = await p.eval("JSON.stringify({ has: !!document.querySelector('.cm-tooltip-autocomplete'), items: document.querySelectorAll('.cm-tooltip-autocomplete li').length })")
  console.log('  [[ 候选弹窗:', popup)
  await p.screenshot(OUT + '/06-输入两个方括号弹出候选.png')
  note('06-输入两个方括号弹出候选.png', 1440, 900)

  // 3) 反链
  await p.goto(APP + '/#/backlinks', { waitMs: 2500 }); await sleep(1500)
  await p.screenshot(OUT + '/09-反向链接.png')
  note('09-反向链接.png', 1440, 900)

  // 4) 导入导出
  await p.goto(APP + '/#/io', { waitMs: 2500 }); await sleep(1800)
  await p.screenshot(OUT + '/12-导入导出.png')
  note('12-导入导出.png', 1440, 900)

  // 5) 统计
  await p.goto(APP + '/#/stats', { waitMs: 2500 }); await sleep(1800)
  await p.screenshot(OUT + '/13-统计.png')
  note('13-统计.png', 1440, 900)

  // 6) 深色主题
  await p.goto(APP + '/#/notes/5', { waitMs: 2500 }); await sleep(1500)
  const themed = await p.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>/主题/.test(x.getAttribute('aria-label')||'')); if(!b) return 'none'; b.click(); return 'clicked'; })()")
  console.log('  主题按钮:', themed)
  await sleep(1200)
  const isDark = await p.eval("document.documentElement.getAttribute('data-theme')")
  console.log('  当前主题:', isDark)
  await p.screenshot(OUT + '/15-深色主题.png')
  note('15-深色主题.png', 1440, 900)
} catch (e) { console.error('desktop 组异常:', e.message) } finally { await b1.close() }

// ---- 平板 900x700 ----
const b2 = await launch({ width: 900, height: 700 })
try {
  const p = await b2.newPage(APP + '/')
  await p.waitForLoad(); await sleep(1200)
  await login(p)
  await p.goto(APP + '/#/notes/5', { waitMs: 2500 }); await sleep(1800)
  await p.screenshot(OUT + '/19-平板-编辑器.png')
  note('19-平板-编辑器.png', 900, 700)
} catch (e) { console.error('平板组异常:', e.message) } finally { await b2.close() }

// ---- 手机 390x844 ----
const b3 = await launch({ width: 390, height: 844 })
try {
  const p = await b3.newPage(APP + '/')
  await p.waitForLoad(); await sleep(1200)
  await login(p)
  // 侧栏抽屉
  const opened = await p.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>/侧栏|菜单|目录/.test((x.getAttribute('aria-label')||'')+(x.title||''))); if(!b) return 'none'; b.click(); return 'clicked'; })()")
  console.log('  抽屉按钮:', opened)
  await sleep(1200)
  await p.screenshot(OUT + '/17-手机-侧栏抽屉.png')
  note('17-手机-侧栏抽屉.png', 390, 844)
  // 搜索
  await p.goto(APP + '/#/search', { waitMs: 2000 }); await sleep(1500)
  await p.screenshot(OUT + '/18-手机-搜索.png')
  note('18-手机-搜索.png', 390, 844)
} catch (e) { console.error('手机组异常:', e.message) } finally { await b3.close() }

console.log('')
console.log('===== 汇总 =====')
for (const r of results) console.log('  ' + (r.ok && r.bytes > 20000 ? 'OK  ' : 'BAD ') + r.file.padEnd(34) + r.size.padEnd(10) + r.bytes + ' B')
import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const APP = (process.argv[2] || 'http://127.0.0.1:8090').replace(/\/$/, '')
const USER = process.argv[3] || 'pwa'
const PASS = process.argv[4] || 'PwaPass1234!'
const b = await launch({ width: 1440, height: 900, scale: 1 })
let pass = 0, fail = 0
const chk = (n, ok, d) => { if (ok) pass++; else fail++; console.log('  [' + (ok?'PASS':'FAIL') + '] ' + n + (d ? '  :: ' + d : '')) }
try {
  const p = await b.newPage(APP + '/')
  await p.waitForLoad(); await sleep(1500)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u," + JSON.stringify(USER) + "); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw," + JSON.stringify(PASS) + "); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2500)
  await p.goto(APP + '/#/graph', { waitMs: 2000 }); await sleep(5000)
  const S = "document.querySelector('.vw-graph__svg')"
  const stat = await p.eval("(() => { const s = " + S + "; if(!s) return 'no svg'; return s.querySelectorAll('circle').length + ' circles / ' + s.querySelectorAll('line').length + ' lines'; })()")
  chk('关系图画出节点与边', /[1-9]\d* circles/.test(String(stat)) && /[1-9]\d* lines/.test(String(stat)), String(stat))
  const summary = await p.eval("(() => { const m = document.body.innerText.match(/(\\d+) 篇笔记 · (\\d+) 条引用/); return m ? m[0] : 'none'; })()")
  chk('摘要显示笔记数与引用数且数字合理', /^\d+ 篇笔记 · \d+ 条引用$/.test(String(summary)), String(summary))
  await p.screenshot('D:/deepseekhums/work/知识库/tools/verify/shots/opt-graph-1440.png')
  const before = await p.eval("(() => { const g = " + S + ".querySelector('g'); return g ? (g.getAttribute('transform')||'none') : 'no g'; })()")
  await p.eval("(() => { const s = " + S + "; const r = s.getBoundingClientRect(); s.dispatchEvent(new WheelEvent('wheel',{deltaY:-240,clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true,cancelable:true})); })()")
  await sleep(800)
  const after = await p.eval("(() => { const g = " + S + ".querySelector('g'); return g ? (g.getAttribute('transform')||'none') : 'no g'; })()")
  chk('滚轮缩放生效', before !== after, String(before).slice(0,36) + ' -> ' + String(after).slice(0,36))
  const clicked = await p.eval("(() => { const s = " + S + "; const c = s.querySelector('circle'); if(!c) return 'none'; c.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 'clicked'; })()")
  await sleep(2200)
  const hash = await p.eval('location.hash')
  chk('点节点跳转到笔记', /#\/notes\/\d+/.test(String(hash)), String(hash))
} catch (e) { fail++; console.log('  异常: ' + e.message) } finally { await b.close() }
console.log('')
console.log('关系图终验: PASS ' + pass + '  FAIL ' + fail)
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
  await p.waitForLoad(); await sleep(2000)
  // 登录
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u," + JSON.stringify(USER) + "); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw," + JSON.stringify(PASS) + "); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(3000)
  chk('主界面加载', true)

  // 1) Chrome 自己解析 manifest
  const mf = await p._send('Page.getAppManifest')
  chk('Chrome 解析 manifest 无错误', !!mf && !mf.errors.length, JSON.stringify(mf && mf.errors))
  chk('manifest url 正确', !!mf && /manifest\.webmanifest/.test(mf.url || ''), mf && mf.url)
  if (mf && mf.data) {
    const d = JSON.parse(mf.data)
    chk('manifest 名称是「知识库」', d.name === '知识库', d.name)
    chk('manifest display=standalone', d.display === 'standalone', d.display)
    chk('manifest 有 3 个图标', Array.isArray(d.icons) && d.icons.length >= 3, d.icons && d.icons.length)
  }

  // 2) SW
  const swState = await p.eval("navigator.serviceWorker.getRegistrations().then(r => JSON.stringify({ n: r.length, scope: r[0] && r[0].scope, active: !!(r[0] && r[0].active) }))")
  const sw = JSON.parse(await swState)
  chk('SW 已注册并激活', sw.n >= 1 && sw.active, JSON.stringify(sw))
  const ctrl = await p.eval("navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : 'none'")
  chk('SW 已接管页面', String(ctrl).includes('/sw.js'), String(ctrl))
  const caches = await p.eval("caches.keys().then(k => JSON.stringify(k))")
  chk('有版本化缓存', JSON.parse(caches).length > 0, caches)
  const apiCached = await p.eval("(async () => { const ks = await caches.keys(); let n = 0; for (const k of ks) { const c = await caches.open(k); for (const req of await c.keys()) { if (new URL(req.url).pathname.startsWith('/api/')) n++ } } return n })()")
  chk('/api/** 完全没有进缓存', apiCached === 0, 'cached api entries=' + apiCached)

  // 3) 关系图
  await p.goto(APP + '/#/graph', { waitMs: 2500 }); await sleep(2500)
  const g = await p.eval("(() => { const svg = document.querySelector('.vw-graph__svg'); if(!svg) return 'no svg'; const circles = svg.querySelectorAll('circle').length; const lines = svg.querySelectorAll('line, path').length; return circles + ' nodes / ' + lines + ' edges'; })()")
  chk('关系图渲染出节点', /\d+ nodes/.test(String(g)) && parseInt(String(g)) > 0, String(g))
  await p.screenshot('D:/deepseekhums/work/知识库/tools/verify/shots/opt-graph-1440.png')

  // 4) 点节点跳转
  const clicked = await p.eval("(() => { const c = document.querySelector('.vw-graph__svg circle'); if(!c) return 'none'; c.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 'clicked'; })()")
  await sleep(1800)
  chk('点节点跳转到笔记', /#\/notes\/\d+/.test(await p.eval('location.hash')), await p.eval('location.hash'))

  // 5) 侧栏入口
  await p.goto(APP + '/#/notes', { waitMs: 1800 }); await sleep(1500)
  const navs = await p.eval("JSON.stringify([...document.querySelectorAll('.kb-sidebar a, .kb-sidebar button')].map(e=>(e.textContent||'').trim()).filter(Boolean).slice(0,14))")
  chk('侧栏有「关系图」', navs.includes('关系图'), navs)
} catch (e) { fail++; console.log('  异常: ' + e.message) } finally { await b.close() }
console.log('')
console.log('PWA/图谱验收: PASS ' + pass + '  FAIL ' + fail)
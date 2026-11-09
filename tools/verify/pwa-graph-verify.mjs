/* PWA + 关系图验收（真实应用）。用法：node pwa-graph-verify.mjs [--base URL] */
import { launch } from './cdp.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const BASE = arg('--base', 'http://127.0.0.1:8090')
const SHOTS = fileURLToPath(new URL('./pwa-shots/', import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, extra) => {
  results.push({ name, ok: !!ok, extra: String(extra === undefined ? '' : extra).slice(0, 400) })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '   >> ' + String(extra).slice(0, 400)))
}
mkdirSync(SHOTS, { recursive: true })

const browser = await launch()
const page = await browser.newPage(BASE + '/')
const ev = (expr) => page.eval(expr)

async function login() {
  await page.waitForLoad()
  await page.waitFor("document.querySelector('.kb-login') !== null || document.querySelector('.kb-sidebar') !== null", { timeout: 30000 })
  if (!(await ev("document.querySelector('.kb-login') !== null"))) return
  await ev('(function(){var u=document.querySelector("input[name=username]");var p=document.querySelector("input[name=password]");var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(u,"demo");u.dispatchEvent(new Event("input",{bubbles:true}));s.call(p,"DemoPass123!");p.dispatchEvent(new Event("input",{bubbles:true}));return true})()')
  await page.click('button[type="submit"]')
  await page.waitFor("document.querySelector('.kb-sidebar') !== null", { timeout: 30000 })
  await sleep(900)
}

try {
  await page.setViewport(1440, 900)
  await login()

  /* ---- manifest ---- */
  const man = await ev('fetch("/manifest.webmanifest").then(function(r){return r.json()})')
  check('manifest: name / short_name 都是「知识库」', man.name === '知识库' && man.short_name === '知识库', JSON.stringify(man.name) + JSON.stringify(man.short_name))
  check('manifest: start_url=/ 且 display=standalone', man.start_url === '/' && man.display === 'standalone', man.start_url + ' / ' + man.display)
  check('manifest: theme=#4f46e5 background=#f6f7f9（取自 tokens）', man.theme_color === '#4f46e5' && man.background_color === '#f6f7f9', man.theme_color + ' / ' + man.background_color)
  const iconSpec = (man.icons || []).map(function(i){ return i.sizes + ':' + i.purpose }).join(',')
  check('manifest: 192 + 512 + maskable 三个图标', iconSpec === '192x192:any,512x512:any,512x512:maskable', iconSpec)
  const iconSizes = await ev('Promise.all(["/icons/icon-192.png","/icons/icon-512.png","/icons/icon-maskable-512.png"].map(function(u){return fetch(u).then(function(r){return r.ok})})).then(function(a){return a.join(",")})')
  check('三个图标 URL 都能取到（HTTP 200）', iconSizes === 'true,true,true', iconSizes)
  const magic = await ev('Promise.all(["/icons/icon-192.png","/icons/icon-512.png","/icons/icon-maskable-512.png"].map(function(u){return fetch(u).then(function(r){return r.arrayBuffer()}).then(function(b){var v=new Uint8Array(b);return v[0].toString(16)+v[1].toString(16)})})).then(function(a){return a.join(",")})')
  check('图标是真 PNG（魔数 8950）', magic === '8950,8950,8950', magic)
  const manLink = await ev("document.querySelector('link[rel=manifest]').getAttribute('href')")
  const appManifest = await page._send('Page.getAppManifest', {})
  check('index.html 正确 link 了 manifest', /manifest\.webmanifest$/.test(String(manLink)), String(manLink))
  const manErrors = (appManifest.errors || []).map(function (e) { return e.message })
  check('Chrome 自己解析 manifest 无错误（Page.getAppManifest）', manErrors.length === 0 && !!appManifest.data, JSON.stringify(manErrors).slice(0, 300) + ' url=' + appManifest.url)

  /* ---- Service Worker ---- */
  await page.waitFor('navigator.serviceWorker.getRegistration().then(function(r){return !!r})', { timeout: 30000 })
  const regInfo = await ev('navigator.serviceWorker.getRegistration().then(function(r){return JSON.stringify({scope:r.scope,state:r.active?r.active.state:"none"})})')
  check('SW 注册成功且已 activated', /"state":"activated"/.test(regInfo), regInfo)
  await page.goto(BASE + '/', { waitMs: 2500 })
  await page.waitFor('navigator.serviceWorker.controller !== null', { timeout: 30000 })
  const ctrl = await ev('navigator.serviceWorker.controller.scriptURL')
  check('SW 已接管页面（controller.scriptURL = /sw.js）', /\/sw\.js$/.test(String(ctrl)), String(ctrl))
  const caches1 = await ev('caches.keys().then(function(k){return k.join(",")})')
  check('缓存名带构建版本（kb-shell-<hash> + kb-assets-<hash>）', /kb-shell-[0-9a-z]+/.test(caches1) && /kb-assets-[0-9a-z]+/.test(caches1), caches1)
  const assetEntries = await ev('caches.keys().then(function(ks){var a=ks.find(function(k){return k.indexOf("kb-assets-")===0});if(!a)return 0;return caches.open(a).then(function(c){return c.keys()}).then(function(all){return all.length})})')
  check('构建产物已预缓存（/assets/* 条目 > 0）', Number(assetEntries) > 0, String(assetEntries))

  /* ---- /api 不进缓存 ---- */
  const apiCached = await ev('caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.open(k).then(function(c){return c.keys()}).then(function(all){return all.filter(function(r){return r.url.indexOf("/api/")>=0}).length})})).then(function(ns){return ns.reduce(function(a,b){return a+b},0)})})')
  check('/api/** 完全没有进缓存', Number(apiCached) === 0, 'api entries=' + apiCached)

  /* ---- 离线 ---- */
  await page._send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  await sleep(400)
  const apiOffline = await ev('fetch("/api/notes").then(function(){return "resolved"}).catch(function(){return "rejected"})')
  check('断网后调 API 直接失败（不会返回过期数据）', apiOffline === 'rejected', String(apiOffline))
  await page.goto(BASE + '/', { waitMs: 3000 })
  const banner = await ev('(function(){var el=document.getElementById("kb-offline-banner");if(!el)return JSON.stringify({exists:false});return JSON.stringify({exists:true,display:el.style.display,text:el.textContent})})()')
  const bnr = JSON.parse(banner)
  check('断网时界面出现「当前离线」提示条（而不是浏览器错误页）', bnr.exists === true && bnr.display === 'block' && /当前离线/.test(String(bnr.text)), banner)
  const offlineText = await ev('document.body.innerText')
  check('断网时仍能打开应用外壳（走缓存，不是错误页）', !/ERR_INTERNET_DISCONNECTED|无法访问此网站/.test(String(offlineText)) && String(offlineText).length > 20, String(offlineText).replace(/\s+/g, ' ').slice(0, 120))
  await page.screenshot(join(SHOTS, 'offline.png'))
  await page._send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await sleep(300)

  /* ---- 侧栏入口顺序 ---- */
  await page.goto(BASE + '/', { waitMs: 2200 })
  await login()
  const nav = await ev('JSON.stringify(Array.prototype.slice.call(document.querySelectorAll(".kb-sidebar button, .kb-sidebar a")).map(function(e){return (e.textContent||"").trim()}).filter(function(t){return t.length>0&&t.length<10}))')
  const navList = JSON.parse(nav)
  const iBack = navList.indexOf('反链')
  const iGraph = navList.indexOf('关系图')
  check('侧栏有「关系图」且紧跟「反链」之后', iGraph >= 0 && iGraph === iBack + 1, nav)

  /* ---- 关系图 ---- */
  await ev('location.hash = "#/graph"')
  await page.waitFor('document.querySelector(".vw-graph__svg") !== null', { timeout: 30000 })
  await sleep(1300)
  const stats = await ev('JSON.stringify({nodes:document.querySelectorAll("[data-node-id]").length,edges:document.querySelectorAll(".vw-graph__edge").length,isolated:document.querySelectorAll(".vw-graph__dot.is-isolated").length,sub:document.querySelector(".vw-graph__sub").textContent})')
  const gs = JSON.parse(stats)
  check('关系图渲染出全部笔记节点', gs.nodes >= 6, stats)
  check('真实双链画成边（演示库 3↔4）', gs.edges >= 2, stats)
  check('孤立笔记也画出来', gs.isolated >= 4, stats)
  check('摘要显示「N 篇笔记 · M 条引用」', /\d+ 篇笔记 · \d+ 条引用/.test(gs.sub), gs.sub)
  await page.screenshot(join(SHOTS, 'graph-desktop-1440.png'))

  const t0 = await ev('document.querySelector(".vw-graph__svg g").getAttribute("transform")')
  await page._send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 470, deltaX: 0, deltaY: -240 })
  await sleep(400)
  const t1 = await ev('document.querySelector(".vw-graph__svg g").getAttribute("transform")')
  check('滚轮缩放生效（transform 变化）', t0 !== t1, t0 + ' → ' + t1)

  await page._send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1000, y: 760, button: 'left', clickCount: 1 })
  await page._send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 880, y: 660, button: 'left' })
  await page._send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 880, y: 660, button: 'left', clickCount: 1 })
  await sleep(400)
  const t2 = await ev('document.querySelector(".vw-graph__svg g").getAttribute("transform")')
  check('拖拽背景平移生效', t1 !== t2, t1 + ' → ' + t2)

  const nodePos = await ev('(function(){var n=document.querySelector("[data-node-id]");var c=n.querySelector(".vw-graph__hit")||n.querySelector("circle");var r=c.getBoundingClientRect();return JSON.stringify({id:n.getAttribute("data-node-id"),x:r.x+r.width/2,y:r.y+r.height/2})})()')
  const np = JSON.parse(nodePos)
  await page._send('Input.dispatchMouseEvent', { type: 'mousePressed', x: np.x, y: np.y, button: 'left', clickCount: 1 })
  await page._send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: np.x, y: np.y, button: 'left', clickCount: 1 })
  await sleep(1300)
  const hash = await ev('location.hash')
  check('点节点打开对应笔记（hash 变成 #/notes/{id}）', String(hash).indexOf('#/notes/' + np.id) === 0, 'clicked=' + np.id + ' hash=' + hash)

  await ev('location.hash = "#/graph"')
  await page.waitFor('document.querySelector(".vw-graph__svg") !== null', { timeout: 25000 })
  await sleep(1100)
  for (const size of [[1440, 900, 'graph-desktop-1440'], [900, 700, 'graph-tablet-900'], [390, 844, 'graph-phone-390']]) {
    await page.setViewport(size[0], size[1])
    await sleep(800)
    const ov = await ev('JSON.stringify({doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})')
    const o = JSON.parse(ov)
    check('关系图 @' + size[0] + '：无横向溢出', o.doc <= o.client, ov)
    await page.screenshot(join(SHOTS, size[2] + '.png'))
  }

  const consoleErrs = await page.consoleErrors()
  check('页面无 console 错误', consoleErrs.length === 0, JSON.stringify(consoleErrs).slice(0, 300))
} finally {
  await browser.close()
}

const passed = results.filter((r) => r.ok).length
const out = results.map((r) => (r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '   >> ' + r.extra))
out.push('', 'RESULT passed ' + passed + '/' + results.length)
if (passed !== results.length) { out.push('FAILED:'); for (const r of results.filter((x) => !x.ok)) out.push('  - ' + r.name + ' >> ' + r.extra) }
writeFileSync(join(SHOTS, 'result.txt'), out.join('\n') + '\n')
console.log(out.join('\n'))
process.exitCode = passed === results.length ? 0 : 1
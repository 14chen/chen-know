import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const b = await launch({ width: 1200, height: 800, scale: 1 })
try {
  const p = await b.newPage('http://127.0.0.1:8090/')
  await p.waitForLoad(); await sleep(3000)
  console.log('标题:', await p.eval('document.title'))
  console.log('body 长度:', String(await p.eval('document.body.innerHTML')).length)
  console.log('body 文本:', String(await p.eval('document.body.innerText')).replace(/\n+/g,' | ').slice(0, 300))
  console.log('script 标签:', await p.eval("JSON.stringify([...document.querySelectorAll('script[src]')].map(s=>s.getAttribute('src')))"))
  console.log('SW controller:', await p.eval("navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : 'none'"))
  console.log('caches:', await p.eval("caches.keys().then(k=>JSON.stringify(k))"))
  const html = await p.eval("fetch('/').then(r=>r.text())")
  console.log('网络拿到的 index 引用:', String(html).match(/src="([^"]+)"/)?.[1] || '(无)')
  console.log('console 错误:', JSON.stringify(await p.consoleErrors()).slice(0, 300))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
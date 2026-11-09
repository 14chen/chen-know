import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const b = await launch({ width: 1440, height: 1400, scale: 1 })
try {
  const p = await b.newPage('https://gitee.com/explore/all')
  await p.waitForLoad()
  await sleep(6000)
  const txt = String(await p.eval('document.body.innerText'))
  console.log('===== 全文（前 2600 字）=====')
  console.log(txt.slice(0, 2600))
  console.log('')
  console.log('===== 项目链接 =====')
  const links = await p.eval("JSON.stringify([...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>h && /^\\/[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+\\/?$/.test(h)).slice(0,25))")
  console.log(links)
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
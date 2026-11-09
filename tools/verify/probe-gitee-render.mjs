import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const b = await launch({ width: 1440, height: 1200, scale: 1 })
try {
  const p = await b.newPage('https://gitee.com/trending')
  await p.waitForLoad()
  await sleep(6000)
  console.log('  标题:', await p.eval('document.title'))
  const txt = await p.eval('document.body.innerText')
  console.log('  正文长度:', String(txt).length)
  console.log('  ---- 前 1200 字 ----')
  console.log(String(txt).slice(0, 1200))
  // 找项目卡片里的链接
  const links = await p.eval("JSON.stringify([...document.querySelectorAll('a')].map(a=>a.getAttribute('href')).filter(h=>h && /^\\/[\\w.-]+\\/[\\w.-]+$/.test(h)).slice(0,20))")
  console.log('  仓库风格链接:', links)
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
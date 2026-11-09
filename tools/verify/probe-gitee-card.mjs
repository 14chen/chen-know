import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const b = await launch({ width: 1440, height: 1400, scale: 1 })
try {
  const p = await b.newPage('https://gitee.com/explore/all')
  await p.waitForLoad()
  await sleep(6500)
  const info = await p.eval("(() => { const el = document.querySelector('.explore-project__item') || document.querySelector('[class*=explore-project]'); if(!el) return 'not found'; return el.className + '||' + el.outerHTML.slice(0, 1800); })()")
  console.log('===== 第一个卡片 =====')
  console.log(String(info).slice(0, 2200))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
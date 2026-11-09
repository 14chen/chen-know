import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const b = await launch({ width: 1440, height: 1400, scale: 1 })
try {
  const p = await b.newPage('https://gitee.com/explore/all')
  await p.waitForLoad()
  await sleep(6500)
  console.log('===== detail-list 直接子元素 =====')
  console.log(await p.eval("(() => { const root = document.querySelector('.explore-projects__detail-list'); if(!root) return 'no root'; return [...root.children].map((e,i)=> i + ': ' + e.tagName + '.' + String(e.className).slice(0,60)).join('\n'); })()"))
  console.log('')
  console.log('===== 第一个项目块的 HTML（前 1200 字）=====')
  const html = await p.eval("(() => { const root = document.querySelector('.explore-projects__detail-list'); if(!root) return ''; const kids = [...root.children].filter(e => e.className && !/selection/.test(e.className)); if(!kids.length) return 'none'; return kids[0].className + '||' + kids[0].outerHTML.slice(0, 1200); })()")
  console.log(String(html).slice(0, 1600))
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
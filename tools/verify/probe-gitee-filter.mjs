import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const b = await launch({ width: 1440, height: 1400, scale: 1 })
try {
  const p = await b.newPage('https://gitee.com/explore/all')
  await p.waitForLoad()
  await sleep(5000)
  console.log('===== 下拉/筛选控件 =====')
  const sels = await p.eval("JSON.stringify([...document.querySelectorAll('select, .dropdown, [class*=select], [class*=filter]')].map(e=>({tag:e.tagName, cls:String(e.className).slice(0,50), txt:(e.textContent||'').trim().slice(0,80)})).slice(0,15))")
  console.log(sels)
  console.log('')
  console.log('===== 所有 option =====')
  const opts = await p.eval("JSON.stringify([...document.querySelectorAll('option')].map(o=>o.textContent.trim()).slice(0,40))")
  console.log(opts)
  console.log('')
  console.log('===== 页面上是否有「本周/周」字样 =====')
  const hasWeek = await p.eval("(() => { const t=document.body.innerText; return JSON.stringify({ 本周: t.includes('本周'), 周: t.includes('周'), 趋势: t.includes('趋势') }); })()")
  console.log(hasWeek)
} catch (e) { console.error('异常:', e.message) } finally { await b.close() }
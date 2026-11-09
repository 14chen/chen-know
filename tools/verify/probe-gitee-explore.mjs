import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const URLS = [
  'https://gitee.com/explore/all',
  'https://gitee.com/explore/recommend',
  'https://gitee.com/explore/gitee_weekly',
  'https://gitee.com/explore/collections',
  'https://gitee.com/explore/trending',
]
const b = await launch({ width: 1440, height: 1200, scale: 1 })
try {
  for (const u of URLS) {
    const p = await b.newPage(u)
    try {
      await p.waitForLoad()
      await sleep(4000)
      const title = await p.eval('document.title')
      const txt = String(await p.eval('document.body.innerText'))
      console.log('--- ' + u)
      console.log('    title: ' + title)
      console.log('    文本长度: ' + txt.length)
      console.log('    片段: ' + txt.replace(/\n+/g, ' | ').slice(0, 220))
} catch (e) { console.log('--- ' + u + '  异常: ' + e.message) }
    await p.close?.()
  }
} finally { await b.close() }
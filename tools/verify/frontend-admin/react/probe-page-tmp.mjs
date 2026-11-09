/** 临时诊断：加载 harness 页面并打印未捕获异常 / __H 状态（用完即删） */
import { Browser } from '../../../../frontend/src/editor/lab/cdp.mjs'

const HARNESS = 'http://localhost:5199/index.html'
const browser = await Browser.launch({})
const page = await browser.newPage(HARNESS)
await new Promise((r) => setTimeout(r, 2500))
const state = await page.eval(
  `({ hasH: typeof window.__H, ready: window.__H?.ready ?? null, bodyLen: document.body.innerHTML.length, hostHtml: (document.getElementById('view-host')?.innerHTML ?? '').slice(0, 120) })`,
)
console.log('state =', JSON.stringify(state))
console.log('page.consoleErrors:')
for (const e of page.consoleErrors.slice(0, 6)) console.log('  ' + String(e).split('\n').slice(0, 4).join(' / '))
await browser.close()

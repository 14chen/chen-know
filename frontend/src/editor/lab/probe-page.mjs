/** 临时：打印 lab 页面的控制台/异常，定位页面为何没挂载 */
import { Browser, sleep } from './cdp.mjs'

const url = process.argv[2] ?? 'http://localhost:5199/editor-lab.html'
const browser = await Browser.launch({})
const page = await browser.newPage(url)
const logs = []
page.cdp.on((msg) => {
  if (msg.sessionId !== page.sid) return
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text))
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description).join(' '))
  }
})
await page.setViewport(1280, 900)
await sleep(5000)
const info = await page.eval(`({
  href: location.href,
  hasLab: !!window.__lab,
  hasEditor: !!document.querySelector('.cm-editor'),
  rootHtml: (document.getElementById('lab-root') || {}).innerHTML?.slice(0, 120) ?? null,
})`)
console.log(JSON.stringify(info, null, 1))
console.log('--- logs ---')
for (const l of logs.slice(0, 15)) console.log(l.slice(0, 400))
await browser.close()

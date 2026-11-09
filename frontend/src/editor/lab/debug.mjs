/** 调试：把当前渲染结果 dump 出来（行文本 / 类名 / widget 计数） */
import { Browser, sleep } from './cdp.mjs'

const LAB_URL = process.argv[2] ?? 'http://localhost:5173/proto/editor-lab.html'

const browser = await Browser.launch({})
const page = await browser.newPage(LAB_URL)
const logs = []
page.cdp.on((msg) => {
  if (msg.sessionId !== page.sid) return
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text))
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    logs.push('[console.error] ' + msg.params.args.map((a) => a.value ?? a.description).join(' '))
  }
})
await page.setViewport(1280, 1000)
await sleep(3000)
await page.eval("window.__lab.setText('- 第一项\\n- 第二项\\n\\n- [ ] 未完成\\n- [x] 已完成\\n\\n> 引用\\n\\n| A | B |\\n| --- | --- |\\n| 1 | 2 |\\n\\n---\\n\\n[[已存在]] 与 [[没写过]]\\n\\n```js\\nconst a = 1\\n```\\n\\n末行')")
await sleep(600)
await page.eval('window.__lab.setCursorLineEnd(17)')
await sleep(400)
const probe = await page.eval('window.__lab.probe()')
console.log(JSON.stringify(probe, null, 1))
console.log('--- logs ---')
for (const l of logs) console.log(l)
await browser.close()

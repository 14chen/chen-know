/** 调试：表格后续行装饰 + 任务复选框两条回归用例 */
import { Browser, sleep } from './cdp.mjs'

const LAB_URL = 'http://localhost:5173/proto/editor-lab.html'

const browser = await Browser.launch({})
const page = await browser.newPage(LAB_URL)
await page.setViewport(1280, 1000)
await sleep(3000)

/* A: 表格块级 widget 后面紧跟标题 */
await page.eval(
  `window.__lab.setText(${JSON.stringify(
    '| A | B |\n| --- | --- |\n| 1 | 2 |\n# 紧跟表格的标题\n\n第二段（光标停这里）\n',
  )})`,
)
await sleep(400)
await page.eval('window.__lab.setCursorLineEnd(6)')
await sleep(400)
const dumpA = await page.eval(`(() => {
  const content = document.querySelector('.cm-content')
  return {
    lines: [...content.children].map((el) => ({ tag: el.tagName, cls: el.className, text: (el.innerText || '').replace(/\\n/g, '\\\\n').slice(0, 40) })),
    tables: window.__lab.probe().tables,
  }
})()`)
console.log('=== A: 表格 + 紧跟标题 ===')
console.log(JSON.stringify(dumpA, null, 1))

/* B: 任务列表复选框 */
await page.eval(
  `window.__lab.setText(${JSON.stringify('- [ ] 待办事项\n第二行（光标停这里）')})`,
)
await sleep(400)
await page.eval('window.__lab.setCursorLineEnd(2)')
await sleep(400)
const dumpB = await page.eval(`(() => {
  const content = document.querySelector('.cm-content')
  return {
    tree: window.__lab.tree(0, 30),
    html: content.children[0]?.outerHTML?.slice(0, 400) ?? null,
    boxes: window.__lab.probe().boxes,
    boxes2: document.querySelectorAll('.cm-kb-checkbox').length,
    lines: [...content.children].map((el) => ({ cls: el.className, text: (el.innerText || '').replace(/\\n/g, '\\\\n').slice(0, 40) })),
  }
})()`)
console.log('=== B: 任务列表 ===')
console.log(JSON.stringify(dumpB, null, 1))

await browser.close()

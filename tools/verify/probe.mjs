// 探明原型真实 DOM 结构，供 Lead 编写独立验收脚本使用。
import { launch } from './cdp.mjs'

const URL = process.argv[2] || 'http://localhost:5173/proto/index.html'
const b = await launch()
try {
  const p = await b.newPage(URL)
  await p.waitForLoad()
  await new Promise((r) => setTimeout(r, 2500))

  const info = await p.eval(`JSON.stringify({
    title: document.title,
    readyState: document.readyState,
    theme: document.documentElement.dataset.theme,
    bodyLen: document.body.innerHTML.length,
    ids: [...document.querySelectorAll('[id]')].map(e => e.id),
    inputs: [...document.querySelectorAll('input,textarea')].map(e => ({
      tag: e.tagName, type: e.type || '', id: e.id, name: e.name,
      ph: e.placeholder || '', aria: e.getAttribute('aria-label') || ''
    })),
    buttons: [...document.querySelectorAll('button')].map(e => ({
      text: (e.textContent || '').trim().slice(0, 24),
      aria: e.getAttribute('aria-label') || '',
      cls: e.className
    })),
    testids: [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')),
    rootHtmlHead: (document.querySelector('#root')?.innerHTML || '').slice(0, 600)
  }, null, 1)`)

  console.log(info)
  console.log('--- 控制台异常 ---')
  console.log(JSON.stringify(await p.consoleErrors(), null, 1))

  await p.screenshot('D:/deepseekhums/work/知识库/tools/verify/_probe.png', { fullPage: false })
  console.log('截图: tools/verify/_probe.png')
} finally {
  await b.close()
}

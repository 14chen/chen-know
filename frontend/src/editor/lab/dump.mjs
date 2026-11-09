/** 调试：dump .cm-content 的每个子节点（行/块级 widget） */
import { Browser, sleep } from './cdp.mjs'

const LAB_URL = 'http://localhost:5173/proto/editor-lab.html'
const FULL = [
  '# 一级标题 H1',
  '## 二级标题 H2',
  '### 三级标题 H3',
  '',
  '段落：**粗体文字**、*斜体文字*、`行内代码`、~~删除的文字~~、[链接文字](https://example.com/)。',
  '',
  '- 第一项',
  '- 第二项',
  '',
  '1. 有序第一项',
  '2. 有序第二项',
  '',
  '- [ ] 未完成任务',
  '- [x] 已完成任务',
  '',
  '> 引用第一行',
  '',
  '```ts',
  'const answer: number = 42 // 关键行',
  '```',
  '',
  '---',
  '',
  '| 名称 | 数量 |',
  '| --- | ---: |',
  '| 苹果 | 12 |',
  '',
  '双链：[[双向链接演示]] 与 [[这篇笔记还没写]]。',
  '',
  '末行普通段落（光标停在这里，其余行全部渲染）。',
].join('\n')

const browser = await Browser.launch({})
const page = await browser.newPage(LAB_URL)
await page.setViewport(1280, 1400)
await sleep(3000)
await page.eval(`window.__lab.setText(${JSON.stringify(FULL)})`)
await sleep(500)
await page.eval('window.__lab.setCursorLineEnd(27)')
await sleep(500)
const dump = await page.eval(`(() => {
  const content = document.querySelector('.cm-content')
  return [...content.children].map((el, i) => ({
    i,
    tag: el.tagName,
    cls: el.className,
    text: (el.innerText || '').replace(/\\n/g, '\\\\n').slice(0, 60),
  }))
})()`)
console.log(JSON.stringify(dump, null, 1))
await browser.close()

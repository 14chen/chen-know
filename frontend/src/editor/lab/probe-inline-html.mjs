/** 临时探针：确认 @lezer/markdown 如何解析内联 HTML 标记（决定渲染实现方式） */
import { Browser, sleep } from './cdp.mjs'

const LAB = 'http://localhost:5199/editor-lab.html'
const SAMPLE = [
  '普通 <mark>高亮</mark> 与 <u>下划线</u> 结束。',
  '颜色 <span style="color:#e11d48">红色</span> 与底色 <span style="background-color:#fef08a">黄底</span>。',
  '嵌套 **<u>粗体下划线</u>** 与 <u>**下划线粗体**</u>。',
  '不认识的 <span class="x" style="color:#fff">属性</span> 与 <div>块标签</div>。',
].join('\n')

const browser = await Browser.launch({})
const page = await browser.newPage(LAB)
await page.setViewport(1280, 900)
await sleep(3000)
await page.eval(`window.__lab.setText(${JSON.stringify(SAMPLE)})`)
await sleep(600)
const tree = await page.eval('window.__lab.tree(0, 400)')
console.log(tree.join('\n'))
await browser.close()

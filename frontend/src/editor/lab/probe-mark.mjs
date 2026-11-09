/** 临时探针：确认黄色块是不是我的 <mark> 装饰（fixture 里并没有 <mark> 标记） */
import { Browser, sleep } from './cdp.mjs'

const LAB = 'http://localhost:5199/editor-lab.html'
const TEXT =
  '这一整段文字用来观察选区效果。选中以后底色必须一眼可见，\n不能只是极淡的一层，否则用户会以为没选中。\n第三行作为对照（不被选中）。'

const browser = await Browser.launch({ width: 1280, height: 900 })
const page = await browser.newPage(LAB)
await page.waitFor('!!window.__lab', { timeout: 30000 })
await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 30000 })
await sleep(400)
await page.eval(`window.__lab.setText(${JSON.stringify(TEXT)})`)
await sleep(500)
await page.eval('window.__lab.setSelection(0, 20)')
await sleep(500)
const info = await page.eval(`(() => ({
  docText: window.__lab.docText(),
  markCount: document.querySelectorAll('mark').length,
  markHl: document.querySelectorAll('mark.cm-kb-hl').length,
  uCount: document.querySelectorAll('u.cm-kb-u').length,
  styledSpans: [...document.querySelectorAll('.cm-content span[style]')].map((s) => s.getAttribute('style')),
  contentHtml: document.querySelector('.cm-content').innerHTML.slice(0, 600),
}))()`)
console.log(JSON.stringify(info, null, 1))
await browser.close()

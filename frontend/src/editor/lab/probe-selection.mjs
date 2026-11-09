/** 临时探针：选区底色为什么看不见？ */
import { Browser, sleep } from './cdp.mjs'

const LAB = 'http://localhost:5199/editor-lab.html'
const browser = await Browser.launch({ width: 1280, height: 900 })
const page = await browser.newPage(LAB)
await page.waitFor('!!window.__lab', { timeout: 30000 })
await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 30000 })
await sleep(400)
await page.eval(`window.__lab.setText("第一行被选中的文字内容。\\n第二行也被选中。\\n第三行对照。")`)
await sleep(300)
await page.eval(`window.__lab.setSelection(0, 20)`)
await sleep(400)

const info = await page.eval(`(() => {
  const selBg = document.querySelector('.cm-selectionBackground')
  const r = selBg.getBoundingClientRect()
  const cx = Math.min(r.x + 60, r.right - 5)
  const cy = r.y + r.height / 2
  const stack = document.elementsFromPoint(cx, cy).slice(0, 6).map((el) => ({
    tag: el.tagName,
    cls: String(el.className).slice(0, 60),
    bg: getComputedStyle(el).backgroundColor,
    zIndex: getComputedStyle(el).zIndex,
    pos: getComputedStyle(el).position,
  }))
  const layer = document.querySelector('.cm-selectionLayer')
  const line = document.querySelector('.cm-line')
  return {
    point: { cx, cy },
    stack,
    selectionLayerStyle: layer ? { zIndex: getComputedStyle(layer).zIndex, position: getComputedStyle(layer).position } : null,
    selectionBg: getComputedStyle(selBg).backgroundColor,
    lineBg: line ? getComputedStyle(line).backgroundColor : null,
    lineCls: line ? line.className : null,
    srcLineBg: (() => {
      const src = document.querySelector('.cm-line.cm-kb-src')
      return src ? getComputedStyle(src).backgroundColor : null
    })(),
  }
})()`)
console.log(JSON.stringify(info, null, 1))

/* 实验：把活动行底纹临时置透明，看选区是否浮现 */
await page.eval(`(() => {
  const s = document.createElement('style')
  s.id = 'probe'
  s.textContent = '.cm-line.cm-kb-src{background:transparent !important}'
  document.head.appendChild(s)
  return true
})()`)
await sleep(300)
const after = await page.eval(`getComputedStyle(document.querySelector('.cm-selectionBackground')).backgroundColor`)
console.log('after removing band, selection bg =', after)
await page.screenshot(String.raw`D:\deepseekhums\work\知识库\frontend\src\editor\lab\shots\probe-noband.png`)
await browser.close()

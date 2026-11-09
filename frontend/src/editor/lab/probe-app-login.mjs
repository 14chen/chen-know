/** 临时：在 8090 真应用里调试登录，打印页面状态 */
import { Browser, sleep } from './cdp.mjs'

const APP = process.argv[2] ?? 'http://127.0.0.1:8090/'
const browser = await Browser.launch({ width: 1440, height: 900 })
const page = await browser.newPage(APP)
const logs = []
page.cdp.on((msg) => {
  if (msg.sessionId !== page.sid) return
  if (msg.method === 'Runtime.exceptionThrown') logs.push('[exc] ' + (msg.params.exceptionDetails.exception?.description ?? '').slice(0, 300))
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') logs.push('[err] ' + msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
})
await page.setViewport(1440, 900)
await sleep(3000)
const stage1 = await page.eval(`({
  url: location.href,
  inputs: [...document.querySelectorAll('input')].map((i) => ({ type: i.type, ph: i.placeholder })),
  buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean),
  body: document.body.innerText.slice(0, 200).replace(/\\n+/g, ' | '),
  hasLab: !!window.__lab,
})`)
console.log('--- 初始 ---')
console.log(JSON.stringify(stage1, null, 1))

const filled = await page.eval(`(() => {
  const inputs = [...document.querySelectorAll('input')]
  if (inputs.length < 2) return false
  const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
  set(inputs[0], 'demo'); set(inputs[1], 'DemoPass123!')
  return { values: inputs.map((i) => i.value) }
})()`)
console.log('--- 填充 ---', JSON.stringify(filled))
const clicked = await page.eval(`(() => {
  const btns = [...document.querySelectorAll('button')]
  const btn = btns.find((b) => /登录/.test(b.textContent))
  if (!btn) return { ok: false, btns: btns.map((b) => b.textContent.trim()) }
  btn.click()
  return { ok: true }
})()`)
console.log('--- 点击登录 ---', JSON.stringify(clicked))
await sleep(4000)
const stage2 = await page.eval(`({
  url: location.href,
  body: document.body.innerText.slice(0, 240).replace(/\\n+/g, ' | '),
  noteItems: document.querySelectorAll('.kb-note-item').length,
  hasEditor: !!document.querySelector('.cm-content'),
})`)
console.log('--- 登录后 ---')
console.log(JSON.stringify(stage2, null, 1))
console.log('--- logs ---')
for (const l of logs.slice(0, 8)) console.log(l)
await browser.close()

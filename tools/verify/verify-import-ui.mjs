// Lead 验收：导入界面是否真的支持图片与文件夹（用户实际会点的那个界面）
import { launch } from './cdp.mjs'
import { mkdirSync } from 'node:fs'

const APP_URL = process.argv[2] || 'http://127.0.0.1:8090/'
const OUT = 'D:/deepseekhums/work/知识库/tools/verify/shots/io-import'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0, fails = []
const check = (n, ok, d = '') => {
  if (ok) pass++; else { fail++; fails.push(`${n} :: ${d}`) }
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? '  :: ' + d : ''}`)
}

const b = await launch({ width: 1440, height: 900 })
try {
  const p = await b.newPage(APP_URL)
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 30000 })
  await p.eval(`(() => {
    const u = document.querySelector('input[name="username"]');
    const pw = document.querySelector('input[name="password"]');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(u, 'demo'); u.dispatchEvent(new Event('input', { bubbles: true }));
    s.call(pw, 'DemoPass123!'); pw.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(200)
  await p.click('button.kb-btn--primary')
  await p.waitFor(`!!document.querySelector('.kb-app')`, { timeout: 30000 })
  await sleep(1800)

  await p.goto(`${APP_URL.split('#')[0]}#/io`, { waitMs: 1800 })
  await sleep(1500)

  console.log('=== 导入界面 ===')
  const inputs = await p.eval(`JSON.stringify([...document.querySelectorAll('input[type=file]')]
    .map(i => ({ accept: i.getAttribute('accept'), multiple: i.multiple, webkitdirectory: i.hasAttribute('webkitdirectory'), hidden: i.offsetParent === null })))`)
  const list = JSON.parse(inputs)
  console.log(`  找到 ${list.length} 个 file input：`)
  list.forEach((i) => console.log(`    accept="${(i.accept || '').slice(0, 90)}" multiple=${i.multiple} webkitdirectory=${i.webkitdirectory}`))

  const folderInput = list.find((i) => i.webkitdirectory)
  check('存在「选择文件夹」输入（webkitdirectory）', !!folderInput)
  const acceptAll = list.map((i) => i.accept || '').join(',')
  check('accept 含图片扩展名 .png/.jpg', /\.png/i.test(acceptAll) && /\.jpe?g/i.test(acceptAll), acceptAll.slice(0, 120))
  check('accept 含新增的 .bmp/.avif', /\.bmp/i.test(acceptAll) && /\.avif/i.test(acceptAll))
  check('accept 仍含 .md 与 .zip', /\.md/i.test(acceptAll) && /\.zip/i.test(acceptAll))

  // 页面上是否有「选择文件夹」按钮
  const btns = await p.eval(`JSON.stringify([...document.querySelectorAll('.kb-main button, .kb-main label, .kb-main [role=button]')]
    .map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 30))`)
  console.log(`  可点元素：${btns}`)
  check('页面上有「文件夹」相关入口', /文件夹/.test(btns), btns.slice(0, 200))

  const text = await p.eval(`document.querySelector('.kb-main').innerText`)
  check('说明文案提到图片', /图片/.test(text), text.slice(0, 160).replace(/\n/g, ' | '))
  await p.screenshot(`${OUT}/io-1440.png`)
  console.log('  ✓ io-1440.png')

  // 手机断点
  await p._send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await p._send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await p.goto(`${APP_URL.split('#')[0]}#/io`, { waitMs: 1800 })
  await sleep(1400)
  const ovf = await p.eval(`JSON.stringify({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth })`)
  const o = JSON.parse(ovf)
  check('手机断点无横向溢出', o.s <= o.c, JSON.stringify(o))
  await p.screenshot(`${OUT}/io-390.png`)
  console.log('  ✓ io-390.png')

  const errs = await p.consoleErrors()
  check('无控制台异常', errs.length === 0, JSON.stringify(errs).slice(0, 200))

  console.log(`\n结果：PASS ${pass}   FAIL ${fail}`)
  fails.forEach((f) => console.log('  - ' + f))
  process.exitCode = fail ? 1 : 0
} catch (e) {
  console.error('异常：', e.message)
  process.exitCode = 2
} finally {
  await b.close()
}

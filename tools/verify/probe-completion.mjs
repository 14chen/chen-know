import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const APP = (process.argv[2] || 'http://127.0.0.1:8090').replace(/\/$/, '')
const U = process.argv[3], P = process.argv[4]

const b = await launch({ width: 1440, height: 900 })
try {
  const p = await b.newPage(APP + '/')
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 20000 })
  await p.eval(`(() => {
    const u = document.querySelector('input[name="username"]');
    const pw = document.querySelector('input[name="password"]');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(u, ${JSON.stringify(U)}); u.dispatchEvent(new Event('input', { bubbles: true }));
    s.call(pw, ${JSON.stringify(P)}); pw.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor(`!!document.querySelector('.kb-app')`, { timeout: 30000 })
  await sleep(2500)

  const notes = await p.eval(`fetch('/api/notes?size=50',{credentials:'same-origin'}).then(r=>r.json()).then(j=>JSON.stringify(j.items.map(n=>({id:n.id,title:n.title}))))`)
  const list = JSON.parse(notes)
  const target = list.find((n) => n.title === 'E2E 全流程笔记') || list[0]
  console.log('目标笔记:', JSON.stringify(target))

  const openAndType = async () => {
    await p.goto(`${APP}#/notes/${target.id}`, { waitMs: 1500 })
    await p.waitFor(`!!document.querySelector('.cm-content')`, { timeout: 20000 })
    await sleep(1200)
    const n = await p.eval(`document.querySelectorAll('.cm-line').length`)
    const box = await p.eval(`(() => {
      const el = document.querySelectorAll('.cm-line')[${n - 1}];
      const r = el.getBoundingClientRect();
      return { x: r.x + 40, y: r.y + r.height / 2 };
    })()`)
    await p.clickAt(box.x, box.y)
    await sleep(400)
    await p._send('Input.insertText', { text: '\n[[E2E' })
    await sleep(1400)
  }
  const docText = () => p.eval(`document.querySelector('.cm-content').innerText`)
  const popupOpen = () => p.eval(`!!document.querySelector('.cm-tooltip-autocomplete') && document.querySelectorAll('.cm-tooltip-autocomplete li').length`)
  const selectedIdx = () => p.eval(`(() => {
    const items = [...document.querySelectorAll('.cm-tooltip-autocomplete li')];
    return items.findIndex(li => li.getAttribute('aria-selected') === 'true');
  })()`)

  console.log('\n--- 1) 输入 [[E2E 后 ---')
  await openAndType()
  console.log('  候选数:', await popupOpen(), ' 当前选中索引:', await selectedIdx())
  await p.screenshot('D:/deepseekhums/work/知识库/tools/verify/shots/e2e-flow/probe-completion.png')

  console.log('\n--- 2) 按 ArrowDown ---')
  await p.press('ArrowDown'); await sleep(500)
  console.log('  选中索引:', await selectedIdx())

  console.log('\n--- 3) 按 Enter ---')
  await p.press('Enter'); await sleep(1200)
  let t = await docText()
  console.log('  含完整 [[E2E 全流程笔记]]:', t.includes('[[E2E 全流程笔记]]'))
  console.log('  文档尾部:', JSON.stringify(t.slice(-40)))

  console.log('\n--- 4) 重来，改用鼠标点候选 ---')
  await openAndType()
  const cnt = await popupOpen()
  console.log('  候选数:', cnt)
  if (cnt > 0) {
    await p.eval(`(() => { const li = document.querySelector('.cm-tooltip-autocomplete li'); if (li) li.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); })()`)
    await sleep(1200)
    t = await docText()
    console.log('  含完整 [[E2E 全流程笔记]]:', t.includes('[[E2E 全流程笔记]]'))
    console.log('  文档尾部:', JSON.stringify(t.slice(-40)))
  }

  console.log('\n--- 5) 重来，按 Escape 看能否关闭 ---')
  await openAndType()
  await p.press('Escape'); await sleep(600)
  console.log('  弹窗仍开:', await popupOpen())
} finally {
  await b.close()
}

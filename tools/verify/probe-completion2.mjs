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
  await sleep(2800)

  const list = JSON.parse(await p.eval(`fetch('/api/notes?size=50',{credentials:'same-origin'}).then(r=>r.json()).then(j=>JSON.stringify(j.items.map(n=>({id:n.id,title:n.title}))))`))
  console.log('库里的笔记:', list.map((n) => n.id + ':' + n.title).join(' | '))
  const src = list.find((n) => n.title === '双链测试本') || list[list.length - 1]
  console.log('打开:', JSON.stringify(src))

  await p.goto(`${APP}#/notes/${src.id}`, { waitMs: 1500 })
  await p.waitFor(`!!document.querySelector('.cm-content')`, { timeout: 20000 })
  await sleep(1500)

  // 光标放最后一行
  const n = await p.eval(`document.querySelectorAll('.cm-line').length`)
  const box = await p.eval(`(() => { const el = document.querySelectorAll('.cm-line')[${n - 1}]; const r = el.getBoundingClientRect(); return {x:r.x+40,y:r.y+r.height/2}; })()`)
  await p.clickAt(box.x, box.y)
  await sleep(400)

  console.log('\n--- 逐字符输入 [[ (用真实 key 事件) ---')
  await p._send('Input.insertText', { text: '\n' })
  await sleep(300)
  for (const ch of '[[E') {
    await p._send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
    await p._send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(250)
  }
  await sleep(1200)
  console.log('文档:', JSON.stringify((await p.eval(`document.querySelector('.cm-content').innerText`)).slice(-40)))
  console.log('tooltip 元素:', await p.eval(`JSON.stringify([...document.querySelectorAll('[class*="tooltip"]')].map(e => ({cls:String(e.className).slice(0,50), txt:(e.innerText||'').slice(0,40).replace(/\\n/g,'/'), vis: e.getBoundingClientRect().width>0})))`))
  console.log('自动补全状态:', await p.eval(`(() => { try { return typeof window.__cmStatus; } catch(e){ return 'n/a' } })()`))
  await p.screenshot('D:/deepseekhums/work/知识库/tools/verify/shots/e2e-flow/probe2-completion.png')

  console.log('\n--- 再补一个 E ---')
  await p._send('Input.dispatchKeyEvent', { type: 'keyDown', text: 'E', key: 'E', unmodifiedText: 'E' })
  await p._send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'E' })
  await sleep(1200)
  console.log('tooltip 元素:', await p.eval(`JSON.stringify([...document.querySelectorAll('[class*="tooltip"]')].map(e => ({cls:String(e.className).slice(0,50), txt:(e.innerText||'').slice(0,50).replace(/\\n/g,'/'), vis: e.getBoundingClientRect().width>0})))`))
} finally {
  await b.close()
}

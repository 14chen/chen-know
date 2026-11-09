import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const b = await launch({ width: 1400, height: 900 })
const typeSlow = async (p, text, gap = 260) => {
  for (const ch of text) {
    await p._send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
    await p._send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(gap)
  }
}
try {
  const p = await b.newPage('http://127.0.0.1:8090/')
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 20000 })
  await p.eval(`(() => {
    const u = document.querySelector('input[name="username"]');
    const pw = document.querySelector('input[name="password"]');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(u, 'demo'); u.dispatchEvent(new Event('input', { bubbles: true }));
    s.call(pw, 'DemoPass123!'); pw.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor(`!!document.querySelector('.kb-app')`, { timeout: 30000 })
  await sleep(2200)

  await p.eval(`(() => { const b=[...document.querySelectorAll('.kb-sidebar button')].find(x=>/新建顶级目录/.test(x.getAttribute('aria-label')||'')); if(b) b.click(); })()`)
  await sleep(900)
  await p.click('.kb-modal input')
  await sleep(400)
  console.log('=== 慢速键入（260ms/字）===')
  await typeSlow(p, 'abc', 260)
  await sleep(700)
  console.log('  value:', JSON.stringify(await p.eval(`document.querySelector('.kb-modal input')?.value`)))
  console.log('  聚焦元素:', await p.eval(`document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0,30)`))

  console.log('\n=== 再快速键入（60ms/字）===')
  await p.eval(`(() => { const i=document.querySelector('.kb-modal input'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i,''); i.dispatchEvent(new Event('input',{bubbles:true})); })()`)
  await sleep(300)
  await typeSlow(p, 'defg', 60)
  await sleep(700)
  console.log('  value:', JSON.stringify(await p.eval(`document.querySelector('.kb-modal input')?.value`)))

  console.log('\n=== 输入法组合（真实 imeSetComposition 流程）===')
  await p.eval(`(() => { const i=document.querySelector('.kb-modal input'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i,''); i.dispatchEvent(new Event('input',{bubbles:true})); i.focus(); })()`)
  await sleep(300)
  await p._send('Input.imeSetComposition', { text: 'biao', selectionStart: 4, selectionEnd: 4 })
  await sleep(500)
  console.log('  组合中 value:', JSON.stringify(await p.eval(`document.querySelector('.kb-modal input')?.value`)))
  await p._send('Input.imeSetComposition', { text: 'biaoqian', selectionStart: 8, selectionEnd: 8 })
  await sleep(500)
  console.log('  继续组合 value:', JSON.stringify(await p.eval(`document.querySelector('.kb-modal input')?.value`)))
  await p._send('Input.insertText', { text: '标签' })
  await sleep(600)
  console.log('  上屏后 value:', JSON.stringify(await p.eval(`document.querySelector('.kb-modal input')?.value`)))
} finally { await b.close() }

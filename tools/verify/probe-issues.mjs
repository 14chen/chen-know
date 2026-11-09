// 复现用户报告的 4 个问题（问题 1/2/3 —— 都是 DOM/行为层，可当场取证）
import { launch } from './cdp.mjs'
import { mkdirSync } from 'node:fs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const APP = (process.argv[2] || 'http://127.0.0.1:8090').replace(/\/$/, '')
const OUT = 'D:/deepseekhums/work/知识库/tools/verify/shots/issues'
mkdirSync(OUT, { recursive: true })

const b = await launch({ width: 1600, height: 1000 })
try {
  const p = await b.newPage(APP + '/')
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
  await sleep(2500)

  const nid = await p.eval(`fetch('/api/notes?size=50',{credentials:'same-origin'}).then(r=>r.json()).then(j=>j.items.find(n=>n.title==='中文排版测试').id)`)
  await p._send('Page.reload'); await p.waitForLoad(); await sleep(1200)
  await p.goto(`${APP}#/notes/${nid}`, { waitMs: 1800 })
  await p.waitFor(`!!document.querySelector('.cm-content')`, { timeout: 20000 })
  await sleep(1500)

  console.log('================ 问题 1：选中文字后能做什么 ================')
  // 点第 3 行中间
  const box = await p.eval(`(() => {
    const ls = document.querySelectorAll('.cm-line');
    const el = ls[Math.min(3, ls.length - 1)];
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width * 0.5, y: r.y + r.height / 2, text: el.innerText };
  })()`)
  console.log('  点击的行:', JSON.stringify(box.text))
  await p.clickAt(box.x, box.y)
  await sleep(400)

  console.log('\n  --- 用 Shift+← 选中 4 个字符 ---')
  for (let i = 0; i < 4; i++) { await p.press('ArrowLeft', { shift: true }); await sleep(120) }
  const sel = await p.eval(`JSON.stringify({ sel: String(window.getSelection()), len: String(window.getSelection()).length, cmSel: (() => { const s = document.querySelector('.cm-selectionBackground'); return s ? 'yes' : 'no' })() })`)
  console.log('  选区:', sel)

  console.log('\n  --- 选中后是否出现任何工具栏/弹窗 ---')
  console.log('  ', await p.eval(`JSON.stringify([...document.querySelectorAll('body > div:not(.kb-app), .cm-tooltip, [class*="toolbar"], [class*="bubble"], [class*="floating"], [class*="selection"]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map(e => ({ tag: e.tagName, cls: String(e.className).slice(0, 60), txt: (e.innerText || '').trim().slice(0, 40).replace(/\\n/g, '/') })))`))
  await p.screenshot(`${OUT}/q1-selection.png`)

  console.log('\n  --- 按 Delete 删除选中的 4 个字符 ---')
  const before = await p.eval(`document.querySelector('.cm-content').innerText.length`)
  await p.press('Backspace')
  await sleep(500)
  const after = await p.eval(`document.querySelector('.cm-content').innerText.length`)
  console.log(`  文本长度 ${before} → ${after}  （减少 ${before - after}）`)
  await p.press('z', { ctrl: true })
  await sleep(500)
  const undo = await p.eval(`document.querySelector('.cm-content').innerText.length`)
  console.log(`  Ctrl+Z 撤销后长度: ${undo}`)

  console.log('\n  --- 编辑器里是否存在任何格式工具栏 ---')
  console.log('  ', await p.eval(`JSON.stringify({
    editorButtons: [...document.querySelectorAll('.kb-editor-region button, .kb-main button')].map(b => (b.getAttribute('aria-label') || (b.textContent||'').trim()).slice(0, 20)),
    toolbarEls: [...document.querySelectorAll('[class*="toolbar"], [class*="format"], [class*="bubble"]')].map(e => String(e.className).slice(0, 50)),
  })`))

  console.log('\n================ 问题 2：删除笔记的入口 ================')
  await p.goto(`${APP}#/notes`, { waitMs: 1500 })
  await sleep(1500)
  console.log('  笔记列表项的 DOM（第一条）:')
  console.log(await p.eval(`(() => {
    const item = document.querySelector('.kb-sidebar [class*="note-item"], .kb-sidebar [class*="notelist"] > *');
    if (!item) return '  未找到列表项';
    return JSON.stringify({ cls: String(item.className), txt: (item.innerText||'').slice(0,40).replace(/\\n/g,'/'),
      btns: [...item.querySelectorAll('button')].map(x => x.getAttribute('aria-label') || (x.textContent||'').trim()) }, null, 1);
  })()`))
  await p.eval(`(() => {
    const item = document.querySelector('.kb-sidebar [class*="note-item"], .kb-sidebar [class*="notelist"] > *');
    if (item) { item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); }
  })()`)
  await sleep(700)
  console.log('  悬停后同一项的按钮:')
  console.log(await p.eval(`(() => {
    const item = document.querySelector('.kb-sidebar [class*="note-item"], .kb-sidebar [class*="notelist"] > *');
    if (!item) return '  未找到';
    return JSON.stringify([...item.querySelectorAll('button')].map(x => ({ aria: x.getAttribute('aria-label'), title: x.getAttribute('title'), w: Math.round(x.getBoundingClientRect().width), vis: getComputedStyle(x).opacity })));
  })()`))
  console.log('  顶栏全部按钮:')
  console.log('  ', await p.eval(`JSON.stringify([...document.querySelectorAll('.kb-topbar button')].map(b => ({ aria: b.getAttribute('aria-label'), txt: (b.textContent||'').trim().slice(0,16) })))`))
  console.log('  侧栏笔记列表区按钮:')
  console.log('  ', await p.eval(`JSON.stringify([...document.querySelectorAll('.kb-sidebar button')].filter(b=>!/kb-nav__item/.test(b.className)).map(b => b.getAttribute('aria-label') || (b.textContent||'').trim().slice(0,16)))`))
  await p.screenshot(`${OUT}/q2-note-list.png`)

  console.log('\n================ 问题 3：笔记视图的左右空白 ================')
  await p.goto(`${APP}#/notes/${nid}`, { waitMs: 1800 })
  await sleep(1500)
  console.log(await p.eval(`(() => {
    const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return { sel, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), maxWidth: cs.maxWidth, padding: cs.paddingLeft + '/' + cs.paddingRight, margin: cs.marginLeft + '/' + cs.marginRight }; };
    return JSON.stringify([pick('.kb-app'), pick('.kb-main'), pick('.kb-editor-region'), pick('.cm-editor'), pick('.cm-content'), pick('.cm-scroller'), pick('.cm-line')].filter(Boolean), null, 1);
  })()`))
  console.log('  视口宽:', await p.eval(`innerWidth`))
  await p.screenshot(`${OUT}/q3-layout.png`)
} finally {
  await b.close()
}

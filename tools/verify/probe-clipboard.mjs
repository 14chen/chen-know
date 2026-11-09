// 问题 1 深入：复制 / 粘贴 / 剪切 / 撤销 这些**原生编辑操作**到底能不能用
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
  await sleep(2200)

  // 建一篇干净笔记，不污染演示数据
  const created = JSON.parse(await p.eval(`(async () => {
    const r = await fetch('/api/notes', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ folderId: null, title: '选区操作测试', content: '# 选区操作测试\\n\\nABCDEFGHIJ 这一行用来测试复制粘贴。\\n' }),
      credentials: 'same-origin' });
    return JSON.stringify(await r.json());
  })()`))
  const NID = created.id
  await p._send('Page.reload'); await p.waitForLoad(); await sleep(1200)
  await p.goto(`${APP}#/notes/${NID}`, { waitMs: 1800 })
  await p.waitFor(`!!document.querySelector('.cm-content')`, { timeout: 20000 })
  await sleep(1400)

  const docText = () => p.eval(`document.querySelector('.cm-content').innerText`)
  console.log('初始:', JSON.stringify((await docText()).slice(0, 70)))

  // 光标放到第 3 行（正文行）行首
  const clickLine = async (i) => {
    const box = await p.eval(`(() => { const ls = document.querySelectorAll('.cm-line'); const el = ls[${i}]; if(!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + 4, y: r.y + r.height/2 }; })()`)
    if (box) { await p.clickAt(box.x, box.y); await sleep(350) }
  }
  await clickLine(2)

  console.log('\n--- ① 选中 5 个字符后 Ctrl+C，再移动光标 Ctrl+V ---')
  for (let i = 0; i < 5; i++) { await p.press('ArrowRight', { shift: true }); await sleep(100) }
  console.log('  选区:', JSON.stringify(String(await p.eval(`String(window.getSelection())`))))
  await p.press('c', { ctrl: true }); await sleep(400)
  console.log('  Ctrl+C 后（无法在 headless 里读系统剪贴板，只验证不报错）')
  // 移到行尾再粘贴
  await p.press('ArrowRight'); await sleep(200)
  await p.press('v', { ctrl: true }); await sleep(600)
  const afterPaste = await docText()
  console.log('  Ctrl+V 后:', JSON.stringify(afterPaste.slice(0, 90)))

  console.log('\n--- ② 用合成 paste 事件插入文本（编辑器监听的是 paste 事件）---')
  const ok = await p.eval(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '【粘贴文本ZZZ】');
    const t = document.querySelector('.cm-content');
    if (!t) return false;
    t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  })()`)
  await sleep(700)
  const afterSynthetic = await docText()
  console.log('  合成 paste 后含【粘贴文本ZZZ】:', afterSynthetic.includes('【粘贴文本ZZZ】'), ' ::', JSON.stringify(afterSynthetic.slice(0, 100)))

  console.log('\n--- ③ Ctrl+X 剪切选区 ---')
  await clickLine(2)
  for (let i = 0; i < 3; i++) { await p.press('ArrowRight', { shift: true }); await sleep(100) }
  const b1 = (await docText()).length
  await p.press('x', { ctrl: true }); await sleep(600)
  const b2 = (await docText()).length
  console.log(`  长度 ${b1} → ${b2}（减少 ${b1 - b2}）`)

  console.log('\n--- ④ Ctrl+Z 撤销 / Ctrl+Y 重做 ---')
  await p.press('z', { ctrl: true }); await sleep(600)
  const u1 = (await docText()).length
  console.log(`  撤销后长度 ${u1}（应回到 ${b1}）`)
  await p.press('y', { ctrl: true }); await sleep(600)
  console.log(`  重做后长度 ${(await docText()).length}`)

  console.log('\n--- ⑤ Ctrl+B / Ctrl+I 是否给选区加粗/斜体 ---')
  await clickLine(2)
  for (let i = 0; i < 4; i++) { await p.press('ArrowRight', { shift: true }); await sleep(100) }
  await p.press('b', { ctrl: true }); await sleep(500)
  const bolded = await docText()
  console.log('  Ctrl+B 后该行:', JSON.stringify(bolded.split('\n').filter((l) => l.includes('ABCDEFG'))[0] || ''))
  await p.screenshot(`${OUT}/q1-clipboard.png`)

  // 清理
  await p.eval(`fetch('/api/notes/${NID}', { method:'DELETE', credentials:'same-origin' }).then(r=>r.status)`)
  await p.eval(`fetch('/api/trash/notes/${NID}', { method:'DELETE', credentials:'same-origin' }).then(r=>r.status)`)
  console.log('\n（测试笔记已清理）')
} finally {
  await b.close()
}

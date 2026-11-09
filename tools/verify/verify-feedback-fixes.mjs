// Lead 的独立验收：本轮 4 条用户反馈对应的修复
// 不重跑实现者的脚本，独立取证；以真实浏览器 + 真实 API 为准。
import { launch } from './cdp.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const APP = (process.argv[2] || 'http://127.0.0.1:8090').replace(/\/$/, '')
const OUT = 'D:/deepseekhums/work/知识库/tools/verify/shots/feedback'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
const fails = []
const check = (n, ok, d = '') => {
  if (ok) pass++; else { fail++; fails.push(`${n}${d ? ' :: ' + d : ''}`) }
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? '  :: ' + d : ''}`)
}
const section = (t) => console.log(`\n${'='.repeat(68)}\n${t}\n${'='.repeat(68)}`)

const b = await launch({ width: 1600, height: 1000 })
let p
const api = async (method, path, payload) =>
  JSON.parse(await p.eval(`(async () => {
    const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)},
      headers: ${payload ? `{'Content-Type':'application/json'}` : '{}'},
      body: ${payload ? JSON.stringify(JSON.stringify(payload)) : 'undefined'},
      credentials: 'same-origin' });
    const t = await r.text();
    return JSON.stringify({ status: r.status, body: t ? JSON.parse(t) : null });
  })()`))
const goto = async (hash, wait = 1500) => { await p.goto(`${APP}${hash}`, { waitMs: 1500 }); await sleep(wait) }
const docText = () => p.eval(`document.querySelector('.cm-content') ? document.querySelector('.cm-content').innerText : ''`)
const waitSaved = async (nid, pred, timeout = 12000) => {
  const t0 = Date.now(); let last = ''
  while (Date.now() - t0 < timeout) {
    const r = await api('GET', `/api/notes/${nid}`); last = r.body?.content || ''
    if (pred(last)) return last
    await sleep(600)
  }
  return last
}
const openNote = async (nid) => {
  const r = await api('GET', `/api/notes/${nid}`)
  const head = (r.body?.content || '').split('\n')[0].slice(0, 10)
  await p._send('Page.reload'); await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('.kb-app')`, { timeout: 30000 }); await sleep(1400)
  await goto(`#/notes/${nid}`, 1200)
  await p.waitFor(`!!document.querySelector('.cm-content')`, { timeout: 20000 })
  if (head) await p.waitFor(`document.querySelector('.cm-content').innerText.includes(${JSON.stringify(head)})`, { timeout: 12000 }).catch(() => {})
  await sleep(900)
}
const clickLine = async (i) => {
  const box = await p.eval(`(() => { const ls=document.querySelectorAll('.cm-line'); const el=ls[${i}]; if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+6,y:r.y+r.height/2}; })()`)
  if (box) { await p.clickAt(box.x, box.y); await sleep(350) }
}
const selRight = async (n) => { for (let i = 0; i < n; i++) { await p.press('ArrowRight', { shift: true }); await sleep(90) } }
const toolbarInfo = () => p.eval(`JSON.stringify((() => {
  const el = [...document.querySelectorAll('[class*="format"], [class*="toolbar"], [class*="bubble"], [role="toolbar"]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 20; });
  if (!el.length) return { found: false };
  const e = el[0]; const r = e.getBoundingClientRect();
  return { found: true, cls: String(e.className).slice(0, 60), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
    buttons: [...e.querySelectorAll('button')].map(x => x.getAttribute('aria-label') || (x.textContent||'').trim().slice(0,10)) };
})())`)
const clickToolbar = async (label) => p.eval(`(() => {
  const el = [...document.querySelectorAll('[class*="format"], [class*="toolbar"], [class*="bubble"], [role="toolbar"]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 20; })[0];
  if (!el) return false;
  const btn = [...el.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').includes(${JSON.stringify(label)}));
  if (!btn) return false;
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  btn.click();
  return true;
})()`)

try {
  p = await b.newPage(APP + '/')
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 30000 })
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

  // 建一篇干净的测试笔记，自建自清
  const created = await api('POST', '/api/notes', {
    folderId: null, title: 'L验收-格式工具栏',
    content: '# L验收\n\nABCDEFGH 这一行用于测试选中格式化。\n\n普通段落第二行 ZZZ。\n',
  })
  const NID = created.body?.id

  // ================= ① 选区格式工具栏 =================
  section('① 选区格式工具栏（问题 1）')
  await openNote(NID)
  await clickLine(2)
  await selRight(6)
  console.log('    选区:', JSON.stringify(await p.eval(`String(window.getSelection())`)))
  const tb = JSON.parse(await toolbarInfo())
  check('1.1 选中文字后出现工具栏', tb.found, JSON.stringify(tb).slice(0, 200))
  if (tb.found) {
    console.log('    工具栏按钮:', JSON.stringify(tb.buttons))
    const selTop = await p.eval(`(() => { const s = window.getSelection(); if (!s.rangeCount) return null; return Math.round(s.getRangeAt(0).getBoundingClientRect().top); })()`)
    check('1.2 工具栏出现在选区上方（或下方夹紧）', tb.bottom <= selTop + 24 || tb.top >= selTop,
      `toolbar top=${tb.top} bottom=${tb.bottom} selection top=${selTop}`)
    await p.screenshot(`${OUT}/1-选区工具栏.png`)
  }

  // 每测一种格式前都要把正文**重置**回干净状态：
  // 否则上一次的标记会叠加（**ABCD** → ***ABCD*** → *~~**AB~~CD***），
  // 选区位置漂移，结果无法判读（本脚本第一版就吃了这个亏）。
  const BASE_CONTENT = '# L验收\n\nABCDEFGH 这一行用于测试选中格式化。\n\n普通段落第二行 ZZZ。\n'
  const fmt = async (label, expect) => {
    await api('PATCH', `/api/notes/${NID}`, { content: BASE_CONTENT })
    await openNote(NID)
    await clickLine(2)
    await selRight(4)
    const clicked = await clickToolbar(label)
    if (!clicked) { check(`1.x 「${label}」按钮存在`, false); return }
    await sleep(900)
    const txt = await waitSaved(NID, (c) => c.includes(expect), 6000)
    check(`1.x 「${label}」→ 正文含 ${expect}`, txt.includes(expect),
      txt.split('\n').find((l) => l.includes('ABCD')) || txt.slice(0, 100))
  }
  await fmt('加粗', '**ABCD**')
  await fmt('斜体', '*ABCD*')
  await fmt('删除线', '~~ABCD~~')
  await fmt('下划线', '<u>ABCD</u>')
  await fmt('高亮', '<mark>ABCD</mark>')
  await fmt('行内代码', '`ABCD`')

  // ================= ② 内联 HTML 渲染 =================
  section('② 内联 HTML 渲染（问题 1 的另一半）')
  await api('PATCH', `/api/notes/${NID}`, {
    content: '# L验收\n\n<mark>高亮词</mark> 与 <u>下划线词</u> 与 <span style="color:#e11d48">红字词</span>\n',
  })
  await openNote(NID)
  await clickLine(0)
  await sleep(700)
  const rendered = JSON.parse(await p.eval(`JSON.stringify((() => {
    const walk = (root) => {
      const out = [];
      const it = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let n;
      while ((n = it.nextNode())) {
        const t = (n.textContent || '').trim();
        if (!t) continue;
        const cs = getComputedStyle(n);
        if (n.tagName === 'MARK' || n.tagName === 'U' || (cs.color === 'rgb(225, 29, 72)') ||
            cs.backgroundColor === 'rgb(254, 240, 138)' || n.tagName === 'SPAN' || n.tagName === 'FONT')
          out.push({ tag: n.tagName, text: t.slice(0, 12), color: cs.color, bg: cs.backgroundColor, deco: cs.textDecorationLine });
      }
      return out;
    };
    return { items: walk(document.querySelector('.cm-content')), rawHasMark: document.querySelector('.cm-content').innerText.includes('<mark>') };
  })())`))
  console.log('    渲染出的元素:', JSON.stringify(rendered.items).slice(0, 300))
  check('2.1 <mark> 渲染为真实高亮（不再是源码）', !rendered.rawHasMark && rendered.items.some((x) => x.tag === 'MARK'), JSON.stringify(rendered).slice(0, 160))
  check('2.2 <u> 渲染为下划线', rendered.items.some((x) => x.tag === 'U' && /underline/.test(x.deco)), JSON.stringify(rendered.items.filter((x) => x.tag === 'U')))
  check('2.3 <span style="color"> 渲染为对应文字色', rendered.items.some((x) => x.color === 'rgb(225, 29, 72)'), JSON.stringify(rendered.items.map((x) => x.color)))
  await p.screenshot(`${OUT}/2-内联HTML渲染.png`)

  // ================= ③ 删除笔记入口 =================
  section('③ 删除笔记入口（问题 2）')
  await goto('#/notes')
  await sleep(1200)
  const itemInfo = JSON.parse(await p.eval(`JSON.stringify((() => {
    const items = [...document.querySelectorAll('.kb-sidebar .kb-note-item')];
    const it = items.find(e => (e.innerText||'').includes('L验收-格式工具栏')) || items[0];
    if (!it) return { found: false };
    it.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const btns = [...it.querySelectorAll('button')].map(x => ({ aria: x.getAttribute('aria-label'), w: Math.round(x.getBoundingClientRect().width), vis: getComputedStyle(x).opacity, disp: getComputedStyle(x).display }));
    return { found: true, cls: String(it.className), btns };
  })())`))
  check('3.1 列表项悬停后出现操作按钮', itemInfo.found && itemInfo.btns.some((x) => x.w > 0 && x.disp !== 'none'),
    JSON.stringify(itemInfo).slice(0, 240))
  await sleep(500)
  const opened = await p.eval(`(() => {
    const items = [...document.querySelectorAll('.kb-sidebar .kb-note-item')];
    const it = items.find(e => (e.innerText||'').includes('L验收-格式工具栏'));
    if (!it) return false;
    it.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const btn = [...it.querySelectorAll('button')].find(x => x.getBoundingClientRect().width > 0);
    if (!btn) return false; btn.click(); return true;
  })()`)
  await sleep(800)
  const menuDelete = await p.eval(`(() => {
    const el = [...document.querySelectorAll('button, [role=menuitem]')].find(x => /^删除/.test((x.textContent||'').trim()) && x.getBoundingClientRect().width > 0);
    if (!el) return false; el.click(); return true;
  })()`)
  check('3.2 点开后能点到「删除」', opened && menuDelete, `openedMenu=${opened} deleteItem=${menuDelete}`)
  await sleep(900)
  const confirmShown = await p.eval(`!!document.querySelector('.kb-modal')`)
  check('3.3 删除前有二次确认', confirmShown, `modal=${confirmShown}`)
  await p.screenshot(`${OUT}/3-删除入口.png`)
  if (confirmShown) {
    const ok = await p.eval(`(() => {
      const btn = [...document.querySelectorAll('.kb-modal button')].find(b => /删除|确定|确认/.test((b.textContent||'').trim()));
      if (!btn) return false; btn.click(); return true;
    })()`)
    await sleep(2500)
    const gone = await api('GET', `/api/notes/${NID}`)
    check('3.4 确认后笔记真的进了回收站', gone.status === 404, `HTTP ${gone.status}`)
    const trash = JSON.parse(await p.eval(`fetch('/api/trash?size=50',{credentials:'same-origin'}).then(r=>r.json()).then(j=>JSON.stringify(j.notes||[])).catch(()=>'[]')`))
    check('3.5 回收站里能找到它', JSON.stringify(trash).includes('L验收-格式工具栏'), JSON.stringify(trash).slice(0, 200))
    // 清理
    await api('DELETE', `/api/trash/notes/${NID}`)
  }

  // ================= ④ 最近浏览接线 =================
  section('④ 「最近浏览」是否真的被记录（附带缺陷）')
  const list = await api('GET', '/api/notes?size=50')
  const targets = list.body.items.slice(0, 3)
  // ⚠️ 不能用「条数增长」判定：/api/recent 有上限，且这些笔记可能早就在最近里
  //    （重复打开只会刷新 viewedAt，不会增加条数）。判据应当是「刚打开的排在最前」。
  for (const t of targets) {
    await goto(`#/notes/${t.id}`, 1400)
    await sleep(900)
  }
  await sleep(1500)
  const afterItems = (await api('GET', '/api/recent')).body?.items || []
  const lastOpened = targets[targets.length - 1]
  check('4.1 最后打开的那篇排在 /api/recent 第一位', (afterItems[0]?.title || '') === lastOpened.title,
    `第一位=${afterItems[0]?.title} 期望=${lastOpened.title}`)
  check('4.2 打开过的那几篇都在最近里', targets.every((t) => afterItems.some((x) => (x.title || '') === t.title)),
    afterItems.map((x) => x.title).join(' | ').slice(0, 160))
  // 同一篇连开 5 次
  const one = targets[0]
  for (let i = 0; i < 5; i++) { await goto(`#/notes/${one.id}`, 1200); await sleep(500) }
  await sleep(1200)
  const recent2 = (await api('GET', '/api/recent')).body?.items || []
  const dupCount = recent2.filter((x) => (x.title || '') === one.title).length
  check('4.3 同一篇连开 5 次只记 1 条', dupCount <= 1, `出现 ${dupCount} 次`)

  // ================= ⑤ 编辑器宽度 =================
  section('⑤ 编辑器宽度与宽屏切换（问题 3）')
  await openNote(list.body.items[0].id)
  await sleep(800)
  const w1 = JSON.parse(await p.eval(`JSON.stringify((() => {
    const e = document.querySelector('.cm-editor'); const pane = document.querySelector('.kb-editor-pane');
    const r = (e || pane).getBoundingClientRect();
    return { width: Math.round(r.width), viewport: innerWidth, editorMax: getComputedStyle(document.documentElement).getPropertyValue('--editor-max').trim() };
  })())`))
  console.log('    窄栏实测:', JSON.stringify(w1))
  check('5.1 窄栏宽度已提升到 ≥850px', w1.width >= 850, JSON.stringify(w1))
  const toggle = await p.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /宽屏|窄栏|全宽/.test(x.getAttribute('aria-label') || x.getAttribute('title') || ''));
    if (!b) return false; b.click(); return true;
  })()`)
  await sleep(900)
  const w2 = JSON.parse(await p.eval(`JSON.stringify((() => {
    const e = document.querySelector('.cm-editor'); const r = e.getBoundingClientRect();
    return { width: Math.round(r.width), viewport: innerWidth, stored: localStorage.getItem('kb.editorWidth') || localStorage.getItem('kb.wide') };
  })())`))
  check('5.2 存在「宽屏/窄栏」切换且点了变宽', toggle && w2.width > w1.width + 100, `${w1.width} → ${w2.width}`)
  await p._send('Page.reload'); await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('.kb-app')`, { timeout: 30000 }); await sleep(2000)
  const w3 = await p.eval(`Math.round(document.querySelector('.cm-editor').getBoundingClientRect().width)`)
  check('5.3 刷新后保持宽屏', w3 > w1.width + 100, `刷新后 ${w3}（窄栏 ${w1.width}）`)
  await p.screenshot(`${OUT}/5-宽屏.png`)
  // 窄屏应隐藏
  await p.setViewport(900, 700, 1)
  await sleep(1200)
  const hiddenAt900 = await p.eval(`![...document.querySelectorAll('button')].some(x => /宽屏|窄栏|全宽/.test(x.getAttribute('aria-label') || x.getAttribute('title') || ''))`)
  check('5.4 ≤1023px 隐藏该按钮', hiddenAt900, `900px 下存在=${!hiddenAt900}`)
  await p.setViewport(1600, 1000, 1)
  await sleep(800)

  // ================= ⑥ 导入缺图引导 =================
  section('⑥ 导入缺图引导（问题 4）')
  await goto('#/io')
  await sleep(1500)
  const scratch = join(tmpdir(), 'kb-fb-assets')
  mkdirSync(scratch, { recursive: true })
  const mdPath = join(scratch, '缺图引导.md')
  writeFileSync(mdPath, '# 缺图引导\n\n![不存在的图](images/nope.png)\n', 'utf8')
  const doc = await p._send('DOM.getDocument', { depth: 0 })
  const node = await p._send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.kb-main input[type=file]:not([webkitdirectory])' })
  await p._send('DOM.setFileInputFiles', { files: [mdPath], nodeId: node.nodeId })
  await sleep(1200)
  await p.eval(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/预览导入内容/.test(x.textContent||'')); if(b) b.click(); })()`)
  await sleep(2500)
  const modalText = await p.eval(`(() => { const m=document.querySelector('.kb-modal'); return m ? m.innerText : ''; })()`)
  console.log('    弹窗文本:', JSON.stringify(modalText.replace(/\n/g, ' | ').slice(0, 300)))
  check('6.1 缺图面板出现', /找不到/.test(modalText))
  check('6.2 文案说明了「没被选中」这个原因', /没有被选中|未选中|没选中/.test(modalText), modalText.slice(0, 120))
  const folderBtn = await p.eval(`(() => {
    const m = document.querySelector('.kb-modal');
    if (!m) return false;
    return [...m.querySelectorAll('button')].some(b => /选择文件夹|改用/.test((b.textContent||'').trim()));
  })()`)
  check('6.3 面板里有「改用选择文件夹」按钮', folderBtn)
  await p.screenshot(`${OUT}/6-缺图引导.png`)

  const errs = await p.consoleErrors()
  check('Z 全程无未捕获异常', errs.length === 0, JSON.stringify(errs).slice(0, 300))
} catch (e) {
  fail++
  fails.push(`运行异常: ${e.message}`)
  console.error('\n异常：', e.message)
  try { await p?.screenshot(`${OUT}/ZZ-异常.png`) } catch {}
} finally {
  console.log(`\n${'='.repeat(68)}`)
  console.log(`用户反馈修复验收：PASS ${pass}   FAIL ${fail}`)
  fails.forEach((f) => console.log('  - ' + f))
  console.log('='.repeat(68))
  await b.close()
  process.exitCode = fail ? 1 : 0
}

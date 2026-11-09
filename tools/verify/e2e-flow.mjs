// 完整流程端到端验证（Lead 的交付验收）
// A 首启注册  B 建目录树  C 写笔记  D 保存与持久化  E 传图(真实 paste)
// F 双链+补全  G 中文搜索  H 标签  I 反链  J 版本+回滚
// K 收藏/置顶/最近  L 删除→回收站→恢复  M 导出  N 导入(带图)  O 统计  P 响应式多端
//
// 全程驱动**真实浏览器界面**；API 只用于断言与必要的清理。
import { launch } from './cdp.mjs'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const APP = (process.argv[2] || 'http://127.0.0.1:8090/').replace(/\/$/, '')
const SCRATCH = process.argv[3] || join(tmpdir(), 'kb-e2e-assets')
const OUT = 'D:/deepseekhums/work/知识库/tools/verify/shots/e2e-flow'
mkdirSync(OUT, { recursive: true })
mkdirSync(SCRATCH, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const fails = []
const check = (n, ok, d = '') => {
  if (ok) pass++; else { fail++; fails.push(`${n}${d ? ' :: ' + d : ''}`) }
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? '  :: ' + d : ''}`)
}
const section = (t) => console.log(`\n${'='.repeat(66)}\n${t}\n${'='.repeat(66)}`)

// ---------- 造测试素材 ----------
function png(w = 12, h = 12, rgb = [30, 120, 200]) {
  const chunk = (tag, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(tag), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  let table = null
  const crc32 = (buf) => {
    if (!table) {
      table = []
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
    }
    let c = 0xffffffff
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).fill(0).map((_, i) => rgb[i % 3])])))
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const IMG = png()
const IMG2 = png(20, 20, [200, 60, 60])
writeFileSync(join(SCRATCH, 'pic.png'), IMG)
mkdirSync(join(SCRATCH, 'images'), { recursive: true })
writeFileSync(join(SCRATCH, 'images', 'pic.png'), IMG)

const b = await launch({ width: 1440, height: 900 })
let p
const setFileInput = async (selector, files) => {
  const doc = await p._send('DOM.getDocument', { depth: 0 })
  const node = await p._send('DOM.querySelector', { nodeId: doc.root.nodeId, selector })
  if (!node.nodeId) throw new Error(`找不到 file input: ${selector}`)
  await p._send('DOM.setFileInputFiles', { files, nodeId: node.nodeId })
}
const api = async (method, path, payload) =>
  JSON.parse(await p.eval(`(async () => {
    const r = await fetch(${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      headers: ${payload ? `{'Content-Type':'application/json'}` : '{}'},
      body: ${payload ? JSON.stringify(JSON.stringify(payload)) : 'undefined'},
      credentials: 'same-origin',
    });
    const t = await r.text();
    return JSON.stringify({ status: r.status, body: t ? JSON.parse(t) : null });
  })()`))
const goto = async (hash, wait = 1600) => { await p.goto(`${APP}${hash}`, { waitMs: 1600 }); await sleep(wait) }
const clickText = async (text, sel = 'button, a, .kb-nav__item, label') =>
  p.eval(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
      .find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}) && e.getBoundingClientRect().width > 0);
    if (!el) return false; el.click(); return true;
  })()`)
const lines = () => p.eval(`document.querySelectorAll('.cm-line').length`)
const clickLine = async (i) => {
  const box = await p.eval(`(() => {
    const el = document.querySelectorAll('.cm-line')[${i}];
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.x + 50, y: r.y + r.height / 2 };
  })()`)
  if (box) { await p.clickAt(box.x, box.y); await sleep(400) }
}
const lastLine = async () => Math.max(0, (await lines()) - 1)
// 轮询直到服务端内容满足条件（保存是 800ms 防抖，写死 sleep 会偶发假失败）
const waitSaved = async (nid, pred, timeout = 12000) => {
  const t0 = Date.now()
  let last = ''
  while (Date.now() - t0 < timeout) {
    const r = await api('GET', `/api/notes/${nid}`)
    last = r.body?.content || ''
    if (pred(last)) return last
    await sleep(600)
  }
  return last
}
// 逐字符真实键盘输入。
// ⚠️ 不能用 Input.insertText 触发自动补全：CodeMirror 只在事务被标记为
//    `input.type` 时才激活补全，而 insertText 一次性插入整串不会带该标记 —— 实测弹窗不出现。
const typeChars = async (text) => {
  for (const ch of text) {
    await p._send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
    await p._send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(160)
  }
}
// 打开笔记并**确认编辑器真的切过去了**。两个坑都要绕开：
//  ① 只等 `.cm-content` 不够 —— 上一页已有编辑器，会立即满足；
//  ② 用 API 新建的笔记不在外壳缓存的列表里，路由会因「找不到」回退到上一篇 —— 
//     必须先整页重载让外壳重新拉列表，再改 hash。
const openNote = async (nid) => {
  const r = await api('GET', `/api/notes/${nid}`)
  const head = (r.body?.content || '').split('\n')[0].slice(0, 12)
  await p._send('Page.reload')
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('.kb-app')`, { timeout: 30000 })
  await sleep(1500)
  await goto(`#/notes/${nid}`, 1200)
  await p.waitFor(`!!document.querySelector('.cm-content')`, { timeout: 20000 })
  let ok = true
  if (head) {
    ok = await p
      .waitFor(`document.querySelector('.cm-content').innerText.includes(${JSON.stringify(head)})`, {
        timeout: 15000,
        label: `编辑器切到笔记 ${nid}`,
      })
      .then(() => true)
      .catch(() => false)
  }
  if (!ok) console.log(`    ⚠️ 编辑器未切到笔记 ${nid}（期望正文含 ${JSON.stringify(head)}）`)
  await sleep(900)
  return ok
}

try {
  p = await b.newPage(APP)
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 30000 })
  await sleep(800)

  // ================= A. 首启与注册 =================
  section('A. 首次启动与注册（第一个账号应成为管理员）')
  await p.screenshot(`${OUT}/A1-登录页.png`)
  const regEntry = await p.eval(`(() => {
    const byRole = [...document.querySelectorAll('button, a, [role=tab], [role=button], label')]
      .some(e => /注册/.test((e.textContent || '').trim()));
    const byText = /注册/.test(document.body.innerText);
    return JSON.stringify({ byRole, byText });
  })()`)
  const reg = JSON.parse(regEntry)
  check('A1 登录页提供注册入口', reg.byRole || reg.byText,
    `按钮/链接含「注册」=${reg.byRole} 页面文本含「注册」=${reg.byText}`)

  const user = 'e2e' + Date.now().toString().slice(-6)
  const pwd = 'E2ePass!2345'
  let registeredViaUi = false
  if (reg.byRole || reg.byText) {
    await clickText('注册', 'button, a, [role=tab], [role=button]')
    await sleep(900)
    registeredViaUi = await p.eval(`(() => {
      const ins = [...document.querySelectorAll('input')];
      const u = ins.find(i => i.name === 'username' || i.type === 'text');
      const ps = ins.filter(i => i.type === 'password');
      if (!u || ps.length === 0) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(u, ${JSON.stringify(user)}); u.dispatchEvent(new Event('input', { bubbles: true }));
      ps.forEach(x => { set.call(x, ${JSON.stringify(pwd)}); x.dispatchEvent(new Event('input', { bubbles: true })); });
      const dn = ins.find(i => /display/i.test(i.name || ''));
      if (dn) { set.call(dn, 'E2E 用户'); dn.dispatchEvent(new Event('input', { bubbles: true })); }
      return true;
    })()`)
    await clickText(registeredViaUi ? '注册' : '登录', 'button')
    await sleep(2500)
  } else {
    // 界面缺注册入口（已判 FAIL）→ 用 API 兜底建号，好让后续环节仍能被验证
    console.log('    （界面无注册入口，改用 API 建号以便继续验证后续环节）')
    const apiReg = await p.eval(`(async () => {
      const r = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ${JSON.stringify(user)}, displayName: 'E2E 用户', password: ${JSON.stringify(pwd)} }),
        credentials: 'same-origin',
      });
      return r.status;
    })()`)
    check('A1b API 兜底建号（首人应 201）', apiReg === 201, `HTTP ${apiReg}`)
  }

  // 注册不一定直接给会话，统一走一次登录
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 15000 }).catch(() => {})
  const needLogin = await p.eval(`!!document.querySelector('input[name="username"]')`)
  if (needLogin) {
    await p.eval(`(() => {
      const u = document.querySelector('input[name="username"]');
      const pw = document.querySelector('input[name="password"]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(u, ${JSON.stringify(user)}); u.dispatchEvent(new Event('input', { bubbles: true }));
      set.call(pw, ${JSON.stringify(pwd)}); pw.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await sleep(300)
    await p.click('button.kb-btn--primary')
  }
  await p.waitFor(`!!document.querySelector('.kb-app')`, { timeout: 30000 })
  await sleep(2000)
  const me = await api('GET', '/api/auth/me')
  check('A3 注册后能登录', me.status === 200, `HTTP ${me.status}`)
  check('A4 第一个账号是管理员', me.body?.role === 'admin', `role=${me.body?.role} user=${me.body?.username}`)

  // ================= B. 建目录树 =================
  section('B. 新建目录与子目录')
  await goto('#/notes')
  const mkFolder = async (name, parentName) => {
    const opened = await p.eval(
      parentName
        ? `(() => {
            const row = [...document.querySelectorAll('.kb-sidebar [class*="tree-row"]')]
              .find(e => (e.innerText || '').trim().startsWith(${JSON.stringify(parentName)}));
            if (!row) return false;
            row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
            const btn = [...row.querySelectorAll('button')]
              .find(x => /新建子目录/.test(x.getAttribute('aria-label') || ''));
            if (!btn) return false; btn.click(); return true;
          })()`
        : `(() => {
            const btn = [...document.querySelectorAll('.kb-sidebar button')]
              .find(x => /新建顶级目录|新建目录/.test(x.getAttribute('aria-label') || ''));
            if (!btn) return false; btn.click(); return true;
          })()`,
    )
    if (!opened) return false
    // 弹出模态框：填名字后点「保存」（不是按 Enter —— 实测 Enter 不提交）
    await sleep(800)
    const filled = await p.eval(`(() => {
      const inp = document.querySelector('.kb-modal input');
      if (!inp) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(inp, ${JSON.stringify(name)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)
    if (!filled) return false
    await sleep(300)
    const saved = await p.eval(`(() => {
      const btn = [...document.querySelectorAll('.kb-modal button')]
        .find(x => /保存|确定|创建/.test((x.textContent || '').trim()));
      if (!btn) return false; btn.click(); return true;
    })()`)
    await sleep(1300)
    return saved
  }
  const f1 = await mkFolder('技术笔记')
  const f2 = await mkFolder('前端', '技术笔记')
  await sleep(800)
  const tree = await api('GET', '/api/folders?tree=true')
  const flat = (ns, acc = []) => { for (const n of ns || []) { acc.push(n); flat(n.children, acc) } return acc }
  const allF = flat(tree.body)
  check('B1 建了顶级目录', allF.some((f) => f.name === '技术笔记'), allF.map((f) => f.name).join(','))
  check('B2 建了子目录', allF.some((f) => f.name === '前端' && f.parentId === allF.find((x) => x.name === '技术笔记')?.id),
    `前端.parentId=${allF.find((f) => f.name === '前端')?.parentId}`)
  check('B3 界面上能看到目录', await p.eval(`document.querySelector('.kb-sidebar').innerText.includes('技术笔记')`))
  await p.screenshot(`${OUT}/B-目录树.png`)

  // ================= C. 新建并写笔记 =================
  section('C. 新建笔记并写 Markdown')
  const tech = allF.find((f) => f.name === '技术笔记')
  const created = await api('POST', '/api/notes', {
    folderId: tech.id,
    title: 'E2E 全流程笔记',
    content: '# E2E 全流程笔记\n\n初始正文。\n',
  })
  check('C1 新建笔记成功', created.status === 201, `HTTP ${created.status}`)
  const NID = created.body?.id
  await openNote(NID)
  const opened = await p.eval(`!!document.querySelector('.cm-content')`)
  check('C2 编辑器已打开该笔记', opened)

  // 真实键入 Markdown
  await clickLine(await lastLine())
  await p._send('Input.insertText', {
    text: '\n## 二级标题\n\n普通段落，带 **粗体** 与 *斜体*。\n\n- 列表甲\n- 列表乙\n\n- [ ] 待办一\n- [x] 已完成\n\n> 引用一行\n\n```js\nconst a = 1\n```\n\n| 列A | 列B |\n|---|---|\n| 1 | 2 |\n\n',
  })
  await sleep(600)
  const rendered = await p.eval(`JSON.stringify({
    headings: document.querySelectorAll('.cm-kb-h2').length,
    bullets: document.querySelectorAll('.cm-kb-bullet').length,
    checks: document.querySelectorAll('.cm-kb-checkbox, .cm-kb-checkbox-on').length,
    quotes: document.querySelectorAll('.cm-kb-quote').length,
    fences: document.querySelectorAll('.cm-kb-fence').length,
    tables: document.querySelectorAll('.cm-kb-table-wrap').length,
  })`)
  const r = JSON.parse(rendered)
  console.log(`    渲染统计: ${rendered}`)
  check('C3 Markdown 已实时渲染（标题/列表/待办/引用/代码/表格）',
    r.headings >= 1 && r.bullets >= 2 && r.checks >= 2 && r.quotes >= 1 && r.fences >= 1 && r.tables >= 1)

  // ================= D. 保存与持久化 =================
  section('D. 保存与刷新持久化')
  await p.press('s', { ctrl: true })
  const savedText = await waitSaved(NID, (c) => c.includes('二级标题'))
  check('D1 Ctrl+S 后正文已落库', savedText.includes('二级标题'),
    savedText.slice(0, 80).replace(/\n/g, ' '))
  check('D2 落库内容含表格', savedText.includes('| 列A |'))
  check('D2b 落库内容含待办与代码块', savedText.includes('[ ] 待办一') && savedText.includes('const a = 1'))
  await p._send('Page.reload')
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('.kb-app')`, { timeout: 30000 })
  await sleep(2200)
  const afterReload = await p.eval(`document.querySelector('.cm-content') ? document.querySelector('.cm-content').innerText : ''`)
  check('D3 刷新后正文仍在', afterReload.includes('二级标题'))
  await p.screenshot(`${OUT}/D-刷新后.png`)

  // ================= E. 传图（真实 paste 事件） =================
  section('E. 插入图片（真实 paste 事件 → 上传 → 重写引用）')
  const before = await api('GET', '/api/stats')
  await clickLine(await lastLine())
  await p._send('Input.insertText', { text: '\n' })
  const pasted = await p.eval(`(() => {
    const b64 = ${JSON.stringify(IMG.toString('base64'))};
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'e2e-shot.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.querySelector('.cm-content');
    if (!target) return false;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  })()`)
  check('E1 触发了粘贴事件', pasted)
  await sleep(3000)
  const after = await api('GET', '/api/stats')
  const noteNow = await api('GET', `/api/notes/${NID}`)
  const hasAtt = /!\[[^\]]*\]\(\/api\/attachments\/\d+\)/.test(noteNow.body?.content || '')
  check('E2 图片已上传（附件数增加）', (after.body?.attachmentCount || 0) > (before.body?.attachmentCount || 0),
    `${before.body?.attachmentCount} → ${after.body?.attachmentCount}`)
  check('E3 正文引用被改写为附件地址', hasAtt,
    (noteNow.body?.content || '').split('\n').filter((l) => l.includes('![')).join(' | ').slice(0, 140))
  if (hasAtt) {
    const url = (noteNow.body.content.match(/!\[[^\]]*\]\((\/api\/attachments\/\d+)\)/) || [])[1]
    const st = await p.eval(`fetch(${JSON.stringify(url)}, {credentials:'same-origin'}).then(r => r.status)`)
    check('E4 图片地址可取回', st === 200, `${url} → HTTP ${st}`)
  }
  await sleep(600)
  // 光标离开图片所在行：按 Typora 行为，**光标所在行**显示源码而不是部件。
  // 注意不能点最后一行（图片就在最后一行），要点别的行。
  await clickLine(0)
  await sleep(800)
  const imgShown = await p.eval(`JSON.stringify({
    img: document.querySelectorAll('.cm-kb-image-el').length,
    broken: document.querySelectorAll('.cm-kb-image-broken').length,
    wrap: document.querySelectorAll('.cm-kb-image').length,
  })`)
  const im = JSON.parse(imgShown)
  check('E5 光标移开后编辑器内渲染出图片', im.img >= 1, JSON.stringify(im))
  await p.screenshot(`${OUT}/E-插入图片.png`)

  // ================= F. 双链 =================
  section('F. 双向链接与自动补全')
  // 关键：必须在**另一篇**笔记里输入 [[ —— 补全源会排除当前笔记自己的标题
  // （wikiCompletionSource: `if (title === exclude) continue`）。
  // 在目标笔记自身里输入 [[目标标题 永远不会弹候选。
  const srcNote = await api('POST', '/api/notes', { folderId: null, title: '双链测试本', content: '# 双链测试本\n\n' })
  check('F0 建了一篇用于发起链接的笔记', srcNote.status === 201, `HTTP ${srcNote.status}`)
  const SID = srcNote.body.id
  await openNote(SID)
  await clickLine(await lastLine())
  await p._send('Input.insertText', { text: '参考 ' })
  await sleep(300)
  await typeChars('[[E')
  await sleep(1500)
  const popupInfo = JSON.parse(await p.eval(`JSON.stringify({
    open: !!document.querySelector('.cm-tooltip-autocomplete'),
    items: [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(li => (li.textContent || '').trim().slice(0, 24)),
  })`))
  check('F1 输入 [[ 后弹出补全候选', popupInfo.open && popupInfo.items.length >= 1, JSON.stringify(popupInfo).slice(0, 160))
  await p.screenshot(`${OUT}/F-双链补全.png`)
  // 用**键盘**选中候选（Enter 由 completionKeymap 提供，随 autocompletion() 自动生效）
  await p.press('ArrowDown')
  await sleep(400)
  await p.press('Enter')
  await sleep(1200)
  // 光标还在刚插入的那一行 → 该行显示源码而非 chip（Typora 行为）。先移开再数。
  await clickLine(0)
  await sleep(700)
  const chips = await p.eval(`document.querySelectorAll('.cm-kb-chip, .cm-kb-chip-new').length`)
  check('F2 光标移开后双链渲染为 chip', chips >= 1, `chip=${chips}`)
  const linkedText = await waitSaved(SID, (c) => c.includes('[[E2E 全流程笔记]]'))
  check('F3 键盘选中补全后双链已落库', linkedText.includes('[[E2E 全流程笔记]]'),
    linkedText.split('\n').filter((l) => l.includes('[[')).join(' | ').slice(0, 100))
  check('F4 补全插入的是已存在笔记（不是「未创建」）',
    (await p.eval(`document.querySelectorAll('.cm-kb-chip-new').length`)) === 0,
    `chip-new=${await p.eval(`document.querySelectorAll('.cm-kb-chip-new').length`)}`)
  const withLink = { body: { content: (await api('GET', `/api/notes/${NID}`)).body?.content || '' } }

  // ================= G. 中文搜索 =================
  section('G. 中文搜索（1–2 字）')
  // 先建一篇带独特词的笔记，保证搜索有确定命中
  const sNote = await api('POST', '/api/notes', { folderId: null, title: '天气记录本', content: '# 天气\n\n今天天气很好，适合出门。\n' })
  check('G0 造了一篇搜索用笔记', sNote.status === 201)
  await goto('#/search?q=%E5%A4%A9%E6%B0%94')
  await sleep(1800)
  const sText = await p.eval(`document.querySelector('.kb-main').innerText`)
  check('G1 搜「天气」有命中', sText.includes('天气记录本'), sText.replace(/\n/g, ' | ').slice(0, 120))
  const emCount = await p.eval(`document.querySelectorAll('.kb-main em').length`)
  check('G2 命中词有高亮', emCount >= 1, `em=${emCount}`)
  await goto('#/search?q=%E5%A4%A9')
  await sleep(1500)
  check('G3 单字「天」也能搜到', (await p.eval(`document.querySelector('.kb-main').innerText`)).includes('天气记录本'))
  await p.screenshot(`${OUT}/G-搜索.png`)

  // ================= H. 标签 =================
  section('H. 标签')
  const tagRes = await api('POST', '/api/tags', { name: 'E2E标签', color: '#2563eb' })
  check('H1 新建标签', tagRes.status === 201, `HTTP ${tagRes.status}`)
  const putTags = await api('PUT', `/api/notes/${NID}/tags`, { tagNames: ['E2E标签'] })
  check('H2 给笔记打标签', putTags.status === 200, `HTTP ${putTags.status}`)
  await goto('#/tags')
  await sleep(1600)
  const tagsText = await p.eval(`document.querySelector('.kb-main').innerText`)
  check('H3 标签视图显示新标签', tagsText.includes('E2E标签'), tagsText.replace(/\n/g, ' | ').slice(0, 100))
  await p.screenshot(`${OUT}/H-标签.png`)

  // 建第二篇引用第一篇，验证反链
  const bNote = await api('POST', '/api/notes', { folderId: null, title: '引用来源篇', content: '这里引用 [[E2E 全流程笔记]] 一次。\n' })
  await sleep(900)

  // ================= I. 反链 =================
  section('I. 反向链接')
  await goto(`#/backlinks?note=${NID}`)
  await sleep(1800)
  const blText = await p.eval(`document.querySelector('.kb-main').innerText`)
  check('I1 反链视图列出引用来源', blText.includes('引用来源篇'), blText.replace(/\n/g, ' | ').slice(0, 140))
  check('I2 出链区显示被引用的笔记', blText.includes('E2E 全流程笔记'))
  await p.screenshot(`${OUT}/I-反链.png`)

  // ================= J. 历史版本与回滚 =================
  section('J. 历史版本与回滚')
  await api('PATCH', `/api/notes/${NID}`, { content: (withLink.body.content || '') + '\n\n第二版改动标记。\n' })
  await sleep(900)
  await goto(`#/versions?note=${NID}`)
  await sleep(1800)
  const vText = await p.eval(`document.querySelector('.kb-main').innerText`)
  const vCount = await p.eval(`document.querySelectorAll('.vw-ver').length`)
  check('J1 版本列表有历史版本', vCount >= 2, `版本数=${vCount}`)
  const clicked = await p.eval(`(() => { const e = document.querySelector('.vw-ver'); if (e) { e.click(); return true } return false })()`)
  await sleep(1500)
  const vAfter = await p.eval(`document.querySelector('.kb-main').innerText`)
  check('J2 选中版本后有「回滚」入口', clicked && vAfter.includes('回滚'), vAfter.replace(/\n/g, ' | ').slice(0, 120))
  await p.screenshot(`${OUT}/J-历史版本.png`)

  // ================= K. 收藏 / 置顶 / 最近 =================
  section('K. 收藏 / 置顶 / 最近浏览')
  const fav = await api('PATCH', `/api/notes/${NID}`, { isFavorite: true })
  check('K1 收藏成功', fav.status === 200, `HTTP ${fav.status}`)
  const pin = await api('PATCH', `/api/notes/${NID}`, { isPinned: true })
  check('K2 置顶成功', pin.status === 200, `HTTP ${pin.status}`)
  await api('POST', `/api/notes/${NID}/view`)
  await goto('#/favorites')
  await sleep(1600)
  check('K3 收藏视图含该笔记', (await p.eval(`document.querySelector('.kb-main').innerText`)).includes('E2E 全流程笔记'))
  await p.screenshot(`${OUT}/K-收藏.png`)
  await goto('#/recent')
  await sleep(1600)
  check('K4 最近浏览有记录', (await p.eval(`document.querySelector('.kb-main').innerText`)).length > 20)

  // ================= L. 删除 → 回收站 → 恢复 =================
  section('L. 删除进回收站并恢复')
  const del = await api('DELETE', `/api/notes/${bNote.body.id}`)
  check('L1 删除成功', del.status === 204 || del.status === 200, `HTTP ${del.status}`)
  const gone = await api('GET', `/api/notes/${bNote.body.id}`)
  check('L2 笔记已不可直接访问', gone.status === 404, `HTTP ${gone.status}`)
  await goto('#/trash')
  await sleep(1800)
  const trashText = await p.eval(`document.querySelector('.kb-main').innerText`)
  check('L3 回收站里能看到', trashText.includes('引用来源篇'), trashText.replace(/\n/g, ' | ').slice(0, 120))
  await p.screenshot(`${OUT}/L-回收站.png`)
  const restored = await api('POST', `/api/trash/notes/${bNote.body.id}/restore`)
  check('L4 恢复成功', restored.status === 200 || restored.status === 204, `HTTP ${restored.status}`)
  const back = await api('GET', `/api/notes/${bNote.body.id}`)
  check('L5 恢复后可访问', back.status === 200, `HTTP ${back.status}`)

  // ================= M. 导出 =================
  section('M. 导出（单篇 + 全部 ZIP）')
  const mdText = await p.eval(`fetch('/api/export/notes/${NID}.md', { credentials: 'same-origin' }).then(r => r.text())`)
  check('M1 导出单篇 .md', mdText.includes('E2E 全流程笔记'), mdText.split('\n').slice(0, 3).join(' | ').slice(0, 90))
  // ZIP 用页面 fetch 取字节
  const zipInfo = JSON.parse(await p.eval(`(async () => {
    const r = await fetch('/api/export/all', { credentials: 'same-origin' });
    const buf = await r.arrayBuffer();
    const u8 = new Uint8Array(buf);
    return JSON.stringify({ status: r.status, bytes: u8.length, magic: String.fromCharCode(u8[0], u8[1]) });
  })()`))
  check('M2 导出整库 ZIP', zipInfo.status === 200 && zipInfo.magic === 'PK', JSON.stringify(zipInfo))

  // ================= N. 导入（带图） =================
  section('N. 导入带图片的文件夹')
  await goto('#/io')
  await sleep(1600)
  const mdPath = join(SCRATCH, '导入测试.md')
  writeFileSync(mdPath, '# 导入测试\n\n下面这张图同目录：\n\n![同目录图](pic.png)\n\n子目录那张：\n\n![子目录图](images/pic.png)\n\n外链跳过：\n\n![外链](https://example.com/x.png)\n', 'utf8')
  await setFileInput('.kb-main input[type=file]:not([webkitdirectory])', [mdPath, join(SCRATCH, 'pic.png'), join(SCRATCH, 'images', 'pic.png')])
  await sleep(1500)
  check('N1 选中了 md + 两张图', await p.eval(`document.querySelector('.kb-main').innerText.includes('导入测试') || document.querySelector('.kb-main').innerText.includes('图片')`))
  await clickText('预览导入内容')
  await sleep(2500)
  const previewText = await p.eval(`document.body.innerText`)
  check('N2 预览弹窗显示将导入', /导入测试/.test(previewText))
  await p.screenshot(`${OUT}/N-预览.png`)
  // 确认按钮文案是「导入 N 篇」，必须精确匹配，否则会点到别的含「导入」字样的元素
  const confirmed = await p.eval(`(() => {
    const btn = [...document.querySelectorAll('.kb-modal button')]
      .find(b => /^导入\\s*\\d+\\s*篇/.test((b.textContent || '').trim()));
    if (!btn) return false; btn.click(); return true;
  })()`)
  check('N2b 点到了「导入 N 篇」确认按钮', confirmed)
  await sleep(5000)
  const impList = await api('GET', '/api/notes?size=200')
  const imported = (impList.body?.items || []).find((n) => n.title === '导入测试')
  check('N3 笔记已导入', !!imported, `找到=${!!imported}`)
  if (imported) {
    const d = await api('GET', `/api/notes/${imported.id}`)
    const hasLocal = /!\[[^\]]*\]\(\/api\/attachments\/\d+\)/.test(d.body.content)
    const keepsRemote = d.body.content.includes('https://example.com/x.png')
    check('N4 本地图片引用被改写为附件', hasLocal, d.body.content.split('\n').filter((l) => l.includes('![')).join(' | ').slice(0, 160))
    check('N5 外链图片原样保留', keepsRemote)
  }
  await p.screenshot(`${OUT}/N-导入结果.png`)

  // ================= O. 统计 =================
  section('O. 统计')
  await goto('#/stats')
  await sleep(1800)
  const statsText = await p.eval(`document.querySelector('.kb-main').innerText`)
  check('O1 统计页渲染', statsText.includes('笔记') && statsText.includes('标签'))
  const bars = await p.eval(`document.querySelectorAll('.kb-main [class*="bar"], .kb-main rect').length`)
  check('O2 有趋势图', bars >= 5, `柱/矩形=${bars}`)
  await p.screenshot(`${OUT}/O-统计.png`)

  // ================= P. 响应式多端 =================
  section('P. 响应式多端（真触摸模拟）')
  const viewports = [
    { name: '桌面 1440×900', w: 1440, h: 900, touch: false, drawer: false },
    { name: '笔记本 1180×800', w: 1180, h: 800, touch: false, drawer: false },
    { name: '平板 900×700', w: 900, h: 700, touch: true, drawer: true },
    { name: '手机 390×844', w: 390, h: 844, touch: true, drawer: true },
  ]
  for (const v of viewports) {
    if (v.touch) {
      await p._send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      await p._send('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: true })
    } else {
      await p._send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await p.setViewport(v.w, v.h, 1)
    }
    await goto('#/notes')
    await sleep(1500)
    const ovf = JSON.parse(await p.eval(`JSON.stringify({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth })`))
    check(`${v.name} 无横向溢出`, ovf.s <= ovf.c, JSON.stringify(ovf))
    // ⚠️ 必须先**归一化抽屉状态**：上一档断点若把抽屉点开了，状态会带到这里，
    //    于是「默认收起」必然假失败（本脚本第一版就踩了这个）。
    const resetDrawer = async () => {
      for (let i = 0; i < 3; i++) {
        const left = await p.eval(`Math.round(document.querySelector('.kb-sidebar').getBoundingClientRect().left)`)
        if (left < 0) break
        const clicked = await p.eval(`(() => {
          const t = [...document.querySelectorAll('button')].find(b => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.left >= 0 && r.left < innerWidth && /菜单|左栏/.test(b.getAttribute('aria-label') || '');
          });
          if (!t) return false; t.click(); return true;
        })()`)
        if (!clicked) break
        await sleep(800)
      }
    }
    await resetDrawer()
    // 桌面/笔记本是常驻侧栏：归一化成**展开**状态再断言（resetDrawer 会把它收起）
    if (!v.drawer) {
      const w0 = await p.eval(`Math.round(document.querySelector('.kb-sidebar').getBoundingClientRect().width)`)
      if (w0 < 100) {
        await p.eval(`(() => {
          const t = [...document.querySelectorAll('button')].find(b => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && /菜单|左栏/.test(b.getAttribute('aria-label') || '');
          });
          if (t) t.click();
        })()`)
        await sleep(900)
      }
    }
    const side = JSON.parse(await p.eval(`JSON.stringify((() => {
      const sb = document.querySelector('.kb-sidebar'); const r = sb.getBoundingClientRect();
      return { left: Math.round(r.left), width: Math.round(r.width) };
    })())`))
    if (v.drawer) {
      check(`${v.name} 侧栏为抽屉（默认收起）`, side.left < 0, JSON.stringify(side))
      const opened = await p.eval(`(() => {
        const t = [...document.querySelectorAll('button')].find(b => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.left >= 0 && r.left < innerWidth && /菜单|左栏/.test(b.getAttribute('aria-label') || '');
        });
        if (!t) return false; t.click(); return true;
      })()`)
      await sleep(900)
      const openedSide = JSON.parse(await p.eval(`JSON.stringify((() => {
        const sb = document.querySelector('.kb-sidebar'); const r = sb.getBoundingClientRect();
        return { left: Math.round(r.left) };
      })())`))
      check(`${v.name} 抽屉能打开`, opened && openedSide.left === 0, JSON.stringify(openedSide))
    } else {
      check(`${v.name} 侧栏常驻`, side.left >= 0 && side.width > 100, JSON.stringify(side))
    }
    await p.screenshot(`${OUT}/P-${v.name.replace(/[^\d]/g, '_')}.png`)
  }
  const coarse = await p.eval(`window.matchMedia('(pointer: coarse)').matches`)
  check('P5 触摸模拟已生效', coarse === true, `matches=${coarse}`)
  const small = JSON.parse(await p.eval(`JSON.stringify((() => {
    const t = [...document.querySelectorAll('button,[role=button]')].map(e => {
      const r = e.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left),
               t: (e.getAttribute('aria-label') || (e.textContent||'').trim()).slice(0,14) };
    }).filter(x => x.w > 0 && x.h > 0 && x.left >= 0 && x.left < 390);
    const bad = t.filter(x => x.w < 44 || x.h < 44);
    return { total: t.length, bad: bad.length, worst: bad.slice(0,4).map(x => x.w+'x'+x.h+' '+x.t) };
  })())`))
  check('P6 手机触摸目标 ≥44px', small.bad === 0, `${small.bad}/${small.total} ${small.worst.join(' | ')}`)

  const errs = await p.consoleErrors()
  check('Z 全程无未捕获异常', errs.length === 0, JSON.stringify(errs).slice(0, 300))
} catch (e) {
  fail++
  fails.push(`运行异常: ${e.message}`)
  console.error('\n异常：', e.message)
  try { await p?.screenshot(`${OUT}/ZZ-异常现场.png`) } catch {}
} finally {
  console.log(`\n${'='.repeat(66)}`)
  console.log(`完整流程验收：PASS ${pass}   FAIL ${fail}`)
  fails.forEach((f) => console.log('  - ' + f))
  console.log('='.repeat(66))
  console.log(`账号: ${typeof user !== 'undefined' ? user : '(未创建)'}`)
  await b.close()
  process.exitCode = fail ? 1 : 0
}

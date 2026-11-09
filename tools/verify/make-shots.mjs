// 生成交付给用户评估的截图集（从真实运行的应用里抓取，不是示意图）。
//
// 安全设计（这一版是重写过的）：
//   · 绝不在演示笔记上做任何「输入后用快捷键撤销」的清理 —— 上一版用 Ctrl+A + Backspace
//     清掉了整篇笔记 #3（已恢复）。用快捷键做清理比它想修的污染更危险。
//   · 需要输入的场景（双链补全）一律用**临时笔记**：先经 API 建、截完经 API 删。
//   · 结束时自查 6 篇演示笔记是否仍与种子逐字节一致，不一致就大声报错。
//
// 用法：node tools/verify/make-shots.mjs [url] [outDir]

import { launch } from './cdp.mjs'
import { mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const APP_URL = process.argv[2] || 'http://127.0.0.1:8080/proto/index.html'
const OUT = process.argv[3] || 'D:/deepseekhums/work/知识库/tools/verify/shots'
const BASE = new URL(APP_URL).origin
const SCRATCH = '__截图临时笔记（可删）__'
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- 极简 API 客户端
let COOKIE = ''

async function api(method, path, payload) {
  const headers = {}
  if (payload !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8'
  if (COOKIE) headers['Cookie'] = COOKIE
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const setCookie = r.headers.getSetCookie?.() ?? []
  if (setCookie.length) COOKIE = setCookie[0].split(';')[0]
  const text = await r.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { _raw: text.slice(0, 200) }
  }
  return { status: r.status, body }
}

async function ensureScratchNote() {
  const login = await api('POST', '/api/auth/login', { username: 'demo', password: 'DemoPass123!' })
  if (login.status !== 200) throw new Error(`登录失败 HTTP ${login.status}`)
  const list = await api('GET', '/api/notes?size=200')
  const found = list.body.items?.find((n) => n.title === SCRATCH)
  if (found) return found.id
  const created = await api('POST', '/api/notes', {
    folderId: null,
    title: SCRATCH,
    content: '# 双链补全演示\n\n在这一行末尾输入两个左方括号，会弹出笔记标题候选：\n\n',
  })
  if (created.status !== 201) throw new Error(`创建临时笔记失败 HTTP ${created.status}`)
  return created.body.id
}

async function removeScratchNote(id) {
  await api('DELETE', `/api/notes/${id}`)
  const purged = await api('DELETE', `/api/trash/notes/${id}`)
  return purged.status
}

// ---------------------------------------------------------------- 主流程
const scratchId = await ensureScratchNote()
console.log(`临时笔记 id=${scratchId}（截图结束后会删除）`)

const b = await launch({ width: 1440, height: 900, scale: 2 })
try {
  const p = await b.newPage(URL)
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 25000 })
  await sleep(800)
  await p.screenshot(`${OUT}/01-登录页.png`)
  console.log('✓ 01-登录页.png')

  await p.eval(`(() => {
    const u = document.querySelector('input[name="username"]');
    const pw = document.querySelector('input[name="password"]');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(u, 'demo'); u.dispatchEvent(new Event('input', { bubbles: true }));
    s.call(pw, 'DemoPass123!'); pw.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(200)
  await p.click('button.kb-btn--primary')
  await p.waitFor(`!!document.querySelector('.cm-content')`, { timeout: 25000 })
  await sleep(1800)

  const openNote = async (title) => {
    const ok = await p.eval(`(() => {
      const el = [...document.querySelectorAll('*')].find(e =>
        (e.textContent || '').trim() === ${JSON.stringify(title)} && e.children.length === 0);
      if (!el) return false; el.click(); return true;
    })()`)
    if (!ok) throw new Error(`找不到笔记: ${title}`)
    await sleep(1800)
  }
  const clickLine = async (i, ox = 60) => {
    const box = await p.eval(`(() => {
      const el = document.querySelectorAll('.cm-line')[${i}];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + ${ox}, y: r.y + r.height / 2 };
    })()`)
    if (!box) return false
    await p.clickAt(box.x, box.y)
    await sleep(500)
    return true
  }
  const lastLine = async () => {
    const n = await p.eval(`document.querySelectorAll('.cm-line').length`)
    return Math.max(0, n - 1)
  }

  // 1) Typora 对比：光标停在标题行
  await openNote('欢迎使用知识库')
  await clickLine(0, 80)
  await sleep(700)
  await p.screenshot(`${OUT}/02-Typora-光标在标题行显示源码.png`)
  console.log('✓ 02-Typora-光标在标题行显示源码.png')

  // 2) Typora 对比：光标移开，全部渲染
  await clickLine(await lastLine())
  await sleep(800)
  await p.screenshot(`${OUT}/03-Typora-光标移开全部渲染.png`)
  console.log('✓ 03-Typora-光标移开全部渲染.png')

  // 3) 代码块与语法高亮
  await openNote('Markdown 速查')
  await clickLine(await lastLine())
  await sleep(700)
  await p.screenshot(`${OUT}/04-代码块与语法高亮.png`)
  console.log('✓ 04-代码块与语法高亮.png')

  // 4) 双向链接两种状态
  await openNote('双向链接演示（A）')
  await clickLine(await lastLine())
  await sleep(700)
  await p.screenshot(`${OUT}/05-双向链接两种状态.png`)
  console.log('✓ 05-双向链接两种状态.png')

  // 5) `[[` 自动补全 —— 在**临时笔记**里做，绝不碰演示数据
  await openNote(SCRATCH)
  await clickLine(await lastLine(), 200)
  await p._send('Input.insertText', { text: '[[' })
  await sleep(1300)
  await p.screenshot(`${OUT}/06-双链自动补全.png`)
  console.log('✓ 06-双链自动补全.png')

  // 6) 深色主题
  await p.click('button[aria-label*="主题"]')
  await sleep(900)
  await openNote('欢迎使用知识库')
  await clickLine(await lastLine())
  await sleep(900)
  await p.screenshot(`${OUT}/07-深色主题.png`)
  console.log('✓ 07-深色主题.png')

  console.log('\n浏览器会话结束')
} finally {
  await b.close()
}

const purgeStatus = await removeScratchNote(scratchId)
console.log(`临时笔记已删除（purge HTTP ${purgeStatus}）`)

// ---------------------------------------------------------------- 自查：演示数据是否被改动
const checker = 'D:/deepseekhums/work/知识库/tools/verify/restore_demo.py'
if (existsSync(checker)) {
  const py = 'C:/Users/HP/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe'
  console.log('\n--- 自查：演示笔记是否仍与种子一致 ---')
  try {
    const out = execFileSync(py, ['-X', 'utf8', checker, BASE, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })
    console.log(out.trim())
    if (!out.includes('0 篇与种子不一致')) {
      console.error('\n⚠️  警告：演示笔记被改动了！请运行 restore_demo.py 恢复。')
      process.exitCode = 1
    }
  } catch (e) {
    console.error('自查脚本执行失败：', e.message)
  }
}

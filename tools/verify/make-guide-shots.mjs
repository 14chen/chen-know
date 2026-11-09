// 生成「图文使用手册」所需的截图（全部从真实运行的应用里抓，不是示意图）。
// 输出到 docs/images/，文件名即手册里引用的名字。
import { launch } from './cdp.mjs'
import { mkdirSync } from 'node:fs'

const APP_URL = process.argv[2] || 'http://127.0.0.1:8080/'
const OUT = 'D:/deepseekhums/work/知识库/docs/images'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const shot = async (p, name) => {
  await p.screenshot(`${OUT}/${name}.png`)
  console.log(`  ✓ ${name}.png`)
}

const b = await launch({ width: 1440, height: 900, scale: 2 })
try {
  const p = await b.newPage(APP_URL)
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 30000 })
  await sleep(900)
  console.log('登录页')
  await shot(p, '02-登录页')

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
  await sleep(2000)

  const goto = async (hash, wait = 1600) => {
    await p.goto(`${APP_URL.split('#')[0]}${hash}`, { waitMs: 1600 })
    await sleep(wait)
  }
  const lastLine = async () => {
    const n = await p.eval(`document.querySelectorAll('.cm-line').length`)
    return Math.max(0, n - 1)
  }
  const clickLine = async (i) => {
    const box = await p.eval(`(() => {
      const el = document.querySelectorAll('.cm-line')[${i}];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + 60, y: r.y + r.height / 2 };
    })()`)
    if (box) { await p.clickAt(box.x, box.y); await sleep(500) }
  }

  // 主界面（笔记视图，光标移开 = 全部渲染）
  await goto('#/notes/1')
  await clickLine(await lastLine())
  await sleep(700)
  console.log('主界面 / 渲染视图')
  await shot(p, '03-主界面-渲染')

  // 光标停在标题行 = 显示源码（手册里要讲的核心）
  await clickLine(0)
  await sleep(700)
  console.log('Typora 行为：光标在标题行')
  await shot(p, '04-光标在标题行显示源码')

  // 再回到渲染态，作对照
  await clickLine(await lastLine())
  await sleep(700)
  await shot(p, '05-光标移开变排版')

  // 双链补全：在临时笔记里做，绝不碰演示数据
  const SCRATCH = '__手册截图临时笔记__'
  const loginBody = JSON.stringify({ username: 'demo', password: 'DemoPass123!' })
  let cookie = ''
  {
    const r = await fetch(`${new URL(APP_URL).origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: loginBody,
    })
    cookie = (r.headers.getSetCookie?.() ?? [])[0]?.split(';')[0] ?? ''
  }
  const api = async (method, path, payload) => {
    const r = await fetch(`${new URL(APP_URL).origin}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json; charset=utf-8', Cookie: cookie },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    return r.status
  }
  await api('POST', '/api/notes', {
    folderId: null,
    title: SCRATCH,
    content: '# 双链演示\n\n在这一行末尾输入两个左方括号：\n\n',
  })
  await sleep(800)
  // 必须整页重载：新建的笔记不在外壳已缓存的列表里，只改 hash 属同文档导航、不会重新拉列表
  await p._send('Page.reload')
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('.kb-app')`, { timeout: 30000 })
  await sleep(2200)
  const opened = await p.eval(`(() => {
    const el = [...document.querySelectorAll('*')].find(e =>
      (e.textContent || '').trim() === ${JSON.stringify(SCRATCH)} && e.children.length === 0);
    if (!el) return false; el.click(); return true;
  })()`)
  if (!opened) {
    console.log('  ⚠️ 未在列表中找到临时笔记，双链截图将缺失')
  }
  if (opened) {
    await sleep(2000)
    await clickLine(await lastLine())
    await p._send('Input.insertText', { text: '[[' })
    await sleep(1500)
    console.log('双链自动补全')
    await shot(p, '06-输入两个方括号弹出候选')
  }
  // 清理临时笔记
  {
    const r = await fetch(`${new URL(APP_URL).origin}/api/notes?size=200`, { headers: { Cookie: cookie } })
    const j = await r.json()
    const t = j.items?.find((n) => n.title === SCRATCH)
    if (t) {
      await api('DELETE', `/api/notes/${t.id}`)
      await api('DELETE', `/api/trash/notes/${t.id}`)
    }
    console.log(`  （临时笔记已清理）`)
  }

  console.log('各功能视图')
  await goto('#/search?q=%E5%A4%A9%E6%B0%94')
  await shot(p, '07-搜索')
  await goto('#/tags')
  await shot(p, '08-标签')
  await goto('#/backlinks?note=3')
  await shot(p, '09-反向链接')
  await goto('#/versions?note=1')
  await p.eval(`(() => { const e = document.querySelector('.vw-ver'); if (e) e.click(); })()`)
  await sleep(1200)
  await shot(p, '10-历史版本')
  await goto('#/trash')
  await shot(p, '11-回收站')
  await goto('#/io')
  await shot(p, '12-导入导出')
  await goto('#/stats')
  await shot(p, '13-统计')
  await goto('#/admin')
  await shot(p, '14-成员管理')

  // 深色主题
  await p.click('button[aria-label*="主题"]')
  await sleep(900)
  await goto('#/notes/1')
  await clickLine(await lastLine())
  await sleep(700)
  console.log('深色主题')
  await shot(p, '15-深色主题')
  // 切回浅色
  await p.click('button[aria-label*="主题"]')
  await sleep(700)

  // 手机版
  console.log('手机 / 平板')
  await p._send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await p._send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  })
  await goto('#/notes/1', 2200)
  await sleep(800)
  await shot(p, '16-手机-编辑器')
  await p.eval(`(() => {
    const t = [...document.querySelectorAll('button')].find(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.left >= 0 && r.left < innerWidth && /菜单|左栏/.test(b.getAttribute('aria-label') || '');
    });
    if (t) t.click();
  })()`)
  await sleep(1000)
  await shot(p, '17-手机-侧栏抽屉')
  await p.eval(`(() => {
    const t = [...document.querySelectorAll('button')].find(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.left >= 0 && r.left < innerWidth && /关闭|遮罩/.test(b.getAttribute('aria-label') || '');
    });
    if (t) t.click();
    else document.querySelector('[class*="scrim"]')?.click();
  })()`)
  await sleep(700)
  await goto('#/search?q=%E5%A4%A9%E6%B0%94', 1800)
  await shot(p, '18-手机-搜索')

  // 平板
  await p._send('Emulation.setDeviceMetricsOverride', {
    width: 900, height: 700, deviceScaleFactor: 2, mobile: true,
  })
  await goto('#/notes/1', 2200)
  await sleep(900)
  await shot(p, '19-平板-编辑器')

  console.log(`\n完成，输出目录：${OUT}`)
} finally {
  await b.close()
}

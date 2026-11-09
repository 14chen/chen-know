// 逐视图内容验收：在真外壳里逐个打开 11 个路由，断言**具体内容**而非「非空」。
// 同时产出交付截图。Lead 的验收工具。

import { launch } from './cdp.mjs'
import { mkdirSync } from 'node:fs'

const APP_URL = process.argv[2] || 'http://127.0.0.1:8080/proto/index.html'
const SHOT_DIR = 'D:/deepseekhums/work/知识库/tools/verify/shots/views'
mkdirSync(SHOT_DIR, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    failures.push(`${name}${detail ? ' :: ' + detail : ''}`)
  }
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  :: ' + detail : ''}`)
}

// 每个视图：路由、名称、期望在页面文本里出现的片段（全部满足才算过）
// clickFirst: 断言前先点击的选择器（某些内容要交互后才出现，例如「回滚」需先选中版本）
const CASES = [
  { hash: '#/notes/1', name: '笔记', expect: ['欢迎使用你的知识库', '待办清单', '装好 JDK 21'] },
  { hash: '#/search?q=%E5%A4%A9%E6%B0%94', name: '搜索', expect: ['天气'] },
  { hash: '#/tags', name: '标签', expect: ['入门', '参考', '排版'] },
  { hash: '#/backlinks?note=3', name: '反链', expect: ['双向链接演示（B）', '这篇笔记还没写'] },
  {
    hash: '#/versions?note=1',
    name: '版本',
    // 版本列表本身即可断言；「回滚」要选中某个历史版本后才出现，
    // 所以先点第一个 .vw-ver（不点它就会误判成缺「回滚」——本脚本第一版就是这样）
    expectBefore: ['当前 v', 'v1'],
    clickFirst: '.vw-ver',
    expect: ['回滚', '当前'],
  },
  { hash: '#/favorites', name: '收藏', expect: ['欢迎使用知识库', '双向链接演示（A）'] },
  { hash: '#/recent', name: '最近', expect: ['Markdown 速查'] },
  { hash: '#/trash', name: '回收站', expect: ['回收站'] },
  { hash: '#/io', name: '导入导出', expect: ['导入', '导出'] },
  { hash: '#/stats', name: '统计', expect: ['笔记', '目录', '标签'] },
  { hash: '#/admin', name: '成员管理', expect: ['演示账号', 'demo'] },
]

const b = await launch({ width: 1440, height: 900, scale: 2 })
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

  console.log('='.repeat(72))
  console.log('逐视图内容验收（真外壳 · 1440×900 · 浅色）')
  console.log('='.repeat(72))

  for (const c of CASES) {
    await p.goto(`${APP_URL.split('#')[0]}${c.hash}`, { waitMs: 1800 })
    await sleep(1400)

    if (c.expectBefore) {
      const t0 = await p.eval(`(document.querySelector('.kb-main') || document.body).innerText`)
      const miss0 = c.expectBefore.filter((e) => !t0.includes(e))
      check(`${c.name}（${c.hash}）列表内容正确`, miss0.length === 0,
        miss0.length ? `缺少：${miss0.join(' / ')}` : c.expectBefore.join(' · '))
    }

    if (c.clickFirst) {
      const ok = await p.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(c.clickFirst)});
        if (!el) return false;
        el.click();
        return true;
      })()`)
      if (!ok) check(`${c.name}：点击 ${c.clickFirst}`, false, '元素不存在')
      await sleep(1200)
    }

    const text = await p.eval(`(document.querySelector('.kb-main') || document.body).innerText`)
    const missing = c.expect.filter((e) => !text.includes(e))
    check(`${c.name}（${c.hash}）内容正确`, missing.length === 0,
      missing.length ? `缺少：${missing.join(' / ')}` : c.expect.join(' · '))
    await p.screenshot(`${SHOT_DIR}/${c.name}.png`)
  }

  // 深色主题下的三张关键视图
  await p.click('button[aria-label*="主题"]')
  await sleep(800)
  console.log('')
  console.log('深色主题关键视图')
  for (const c of CASES.filter((x) => ['笔记', '标签', '统计'].includes(x.name))) {
    await p.goto(`${APP_URL.split('#')[0]}${c.hash}`, { waitMs: 1600 })
    await sleep(1200)
    await p.screenshot(`${SHOT_DIR}/深色-${c.name}.png`)
    console.log(`  ✓ 深色-${c.name}.png`)
  }

  const errs = await p.consoleErrors()
  check('全程无未捕获异常', errs.length === 0, JSON.stringify(errs).slice(0, 200))

  console.log('')
  console.log('='.repeat(72))
  console.log(`结果：PASS ${pass}   FAIL ${fail}`)
  failures.forEach((f) => console.log('  - ' + f))
  console.log('='.repeat(72))
  process.exitCode = fail ? 1 : 0
} catch (e) {
  console.error('异常：', e.message)
  process.exitCode = 2
} finally {
  await b.close()
}

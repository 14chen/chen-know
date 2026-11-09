// 精确诊断：① 找到顶栏的侧栏开关（left>=0 的那个）② 在 pointer:coarse 下量真实触摸目标
import { launch } from './cdp.mjs'

const APP_URL = process.argv[2] || 'http://127.0.0.1:8080/proto/index.html'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await launch({ width: 1440, height: 900 })
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
  await sleep(1500)

  for (const bp of [
    { name: '平板', w: 900, h: 700 },
    { name: '手机', w: 390, h: 844 },
  ]) {
    console.log('='.repeat(72))
    console.log(`${bp.name} ${bp.w}×${bp.h}  （pointer: coarse 模拟）`)
    console.log('='.repeat(72))
    await p._send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'any-pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    })
    await p.eval(`localStorage.removeItem('kb.sidebar')`)
    await p.setViewport(bp.w, bp.h, 1)
    await p.goto(`${APP_URL}#/notes/1`, { waitMs: 2000 })
    await sleep(1200)

    const coins = await p.eval(`window.matchMedia('(pointer: coarse)').matches`)
    console.log(`  matchMedia('(pointer: coarse)') = ${coins}`)

    // 视口内（left>=0）的按钮 —— 这才是用户能点到的
    const inView = await p.eval(`JSON.stringify([...document.querySelectorAll('button, [role="button"]')]
      .map(b => {
        const r = b.getBoundingClientRect();
        return {
          label: (b.getAttribute('aria-label') || b.getAttribute('title') || (b.textContent||'').trim()).slice(0, 22),
          cls: b.className,
          w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left)
        };
      })
      .filter(x => x.w > 0 && x.left >= 0 && x.left < innerWidth)
    )`)
    const list = JSON.parse(inView)
    console.log(`  视口内按钮 ${list.length} 个：`)
    list.slice(0, 16).forEach((x) => {
      const flag = x.w < 44 || x.h < 44 ? ' ⚠️<44' : ''
      console.log(`     ${String(x.w + 'x' + x.h).padEnd(9)} ${x.label}${flag}`)
    })
    const small = list.filter((x) => x.w < 44 || x.h < 44)
    console.log(`  → 视口内偏小：${small.length}/${list.length}`)

    // 点击视口内的侧栏开关
    const clicked = await p.eval(`(() => {
      const t = [...document.querySelectorAll('button')].find(b => {
        const r = b.getBoundingClientRect();
        const lab = (b.getAttribute('aria-label') || b.getAttribute('title') || '');
        return r.left >= 0 && r.left < innerWidth && r.width > 0 &&
               /左栏|菜单|侧栏|sidebar|menu|导航/i.test(lab);
      });
      if (!t) return 'NO_IN_VIEW_BUTTON';
      const lab = (t.getAttribute('aria-label') || t.getAttribute('title') || '').trim();
      t.click();
      return lab;
    })()`)
    await sleep(900)
    const after = await p.eval(`(() => {
      const sb = document.querySelector('.kb-sidebar');
      const r = sb.getBoundingClientRect();
      return JSON.stringify({ left: Math.round(r.left), width: Math.round(r.width), scrim: !!document.querySelector('[class*="scrim"]') });
    })()`)
    console.log(`  点击「${clicked}」→ ${after}`)
    if (coins && small.length) {
      console.log(`  ⚠️ 触摸设备下这些偏小：`)
      small.slice(0, 8).forEach((x) => console.log(`       ${x.w}x${x.h}  ${x.label}   [${x.cls.split(' ').slice(0,2).join('.')}]`))
    }
    console.log()
  }
} finally {
  await b.close()
}

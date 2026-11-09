// 手机 + pointer:coarse + **抽屉打开** 状态下，量目录树与侧栏内的可点目标真实尺寸。
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

  await p._send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await p._send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  })
  await p.eval(`localStorage.removeItem('kb.sidebar')`)
  await p.goto(`${APP_URL}#/notes/1`, { waitMs: 2000 })
  await sleep(1200)
  console.log(`pointer:coarse = ${await p.eval(`window.matchMedia('(pointer: coarse)').matches`)}`)

  // 打开抽屉（只点视口内的那个）
  const opened = await p.eval(`(() => {
    const t = [...document.querySelectorAll('button')].find(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.left >= 0 && r.left < innerWidth &&
             /左栏|菜单|侧栏|菜单/i.test((b.getAttribute('aria-label') || ''));
    });
    if (!t) return false;
    t.click(); return true;
  })()`)
  await sleep(900)
  const geom = await p.eval(`(() => { const r = document.querySelector('.kb-sidebar').getBoundingClientRect();
    return JSON.stringify({ left: Math.round(r.left), width: Math.round(r.width) }); })()`)
  console.log(`抽屉已打开=${opened}  侧栏 ${geom}`)

  // 展开「技术」目录以露出子目录与行内操作
  const expanded = await p.eval(`(() => {
    const el = [...document.querySelectorAll('.kb-sidebar *')].find(e =>
      (e.textContent || '').trim().startsWith('技术') && e.getBoundingClientRect().width > 0);
    if (!el) return false;
    el.click(); return true;
  })()`)
  await sleep(700)
  console.log(`展开「技术」=${expanded}`)

  const rep = await p.eval(`JSON.stringify((() => {
    const cells = [...document.querySelectorAll('.kb-sidebar button, .kb-sidebar [role="button"]')]
      .map(e => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return {
          w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left),
          label: (e.getAttribute('aria-label') || e.getAttribute('title') || (e.textContent || '').trim()).slice(0, 22),
          opacity: cs.opacity,
        };
      })
      .filter(x => x.w > 0 && x.h > 0 && x.left >= 0 && x.left < innerWidth);
    const bad = cells.filter(x => x.w < 44 || x.h < 44);
    return { total: cells.length, bad: bad.length, list: cells, worst: bad.slice(0, 10) };
  })())`)
  const r = JSON.parse(rep)
  console.log(`\n抽屉内可点目标 ${r.total} 个，小于 44px 的 ${r.bad} 个：`)
  r.list.forEach((x) => {
    const flag = x.w < 44 || x.h < 44 ? ' ⚠️' : ' ✅'
    console.log(`   ${String(x.w + 'x' + x.h).padEnd(9)} opacity=${x.opacity.padEnd(4)} ${x.label}${flag}`)
  })
  await p.screenshot('D:/deepseekhums/work/知识库/tools/verify/shots/responsive/_diag-phone-drawer.png')
  console.log('\n截图：_diag-phone-drawer.png')
} finally {
  await b.close()
}

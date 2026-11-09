// 聚焦诊断：① 平板/手机侧栏开关为何无效 ② 触摸目标真实尺寸
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
    console.log('='.repeat(70))
    console.log(`${bp.name} ${bp.w}×${bp.h}`)
    console.log('='.repeat(70))
    // 每次从干净状态开始：清掉折叠偏好
    await p.eval(`localStorage.removeItem('kb.sidebar')`)
    await p.setViewport(bp.w, bp.h, 1)
    await p.goto(`${APP_URL}#/notes/1`, { waitMs: 2000 })
    await sleep(1200)

    const info = await p.eval(`JSON.stringify((() => {
      const sb = document.querySelector('.kb-sidebar');
      const r = sb ? sb.getBoundingClientRect() : null;
      const btns = [...document.querySelectorAll('button')].map(b => {
        const br = b.getBoundingClientRect();
        return {
          label: (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().slice(0, 20),
          cls: b.className.split(' ').slice(0,2).join('.'),
          w: Math.round(br.width), h: Math.round(br.height), left: Math.round(br.left),
          visible: br.width > 0 && br.height > 0
        };
      }).filter(x => x.visible);
      return {
        sidebar: r ? { left: Math.round(r.left), width: Math.round(r.width), pos: getComputedStyle(sb).position } : null,
        appClass: document.querySelector('.kb-app')?.className,
        coins: window.matchMedia('(pointer: coarse)').matches,
        narrow: window.matchMedia('(max-width: 767px)').matches,
        buttons: btns,
      };
    })())`)
    const d = JSON.parse(info)
    console.log(`  .kb-app class = ${d.appClass}`)
    console.log(`  pointer:coarse=${d.coins}  max-width:767px=${d.narrow}`)
    console.log(`  侧栏 position=${d.sidebar?.pos} left=${d.sidebar?.left} width=${d.sidebar?.width}`)
    console.log(`  前 12 个可见按钮：`)
    d.buttons.slice(0, 12).forEach((x) =>
      console.log(`     ${String(x.w + 'x' + x.h).padEnd(9)} left=${String(x.left).padEnd(5)} ${x.label}  [${x.cls}]`),
    )

    // 找菜单/侧栏按钮并点击，观察变化
    const clicked = await p.eval(`(() => {
      const t = [...document.querySelectorAll('button')].find(b =>
        /左栏|菜单|侧栏|sidebar|menu/i.test((b.getAttribute('aria-label') || '') + (b.getAttribute('title') || '')));
      if (!t) return 'NO_BUTTON';
      const lab = (t.getAttribute('aria-label') || t.getAttribute('title') || '').trim();
      t.click();
      return lab;
    })()`)
    await sleep(900)
    const after = await p.eval(`JSON.stringify((() => {
      const sb = document.querySelector('.kb-sidebar');
      const r = sb ? sb.getBoundingClientRect() : null;
      return {
        left: r ? Math.round(r.left) : null,
        width: r ? Math.round(r.width) : null,
        appClass: document.querySelector('.kb-app')?.className,
        scrim: !!document.querySelector('[class*="scrim"]'),
        stored: localStorage.getItem('kb.sidebar'),
      };
    })())`)
    console.log(`  点击「${clicked}」后：${after}`)
    await p.screenshot(`D:/deepseekhums/work/知识库/tools/verify/shots/responsive/_diag-${bp.name}.png`)
    console.log()
  }
} finally {
  await b.close()
}

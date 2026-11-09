// 查实「历史版本」视图到底渲染了什么
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

  await p.goto(`${APP_URL.split('#')[0]}#/versions?note=1`, { waitMs: 2000 })
  await sleep(1800)
  const main = await p.eval(`(document.querySelector('.kb-main') || document.body).innerText`)
  console.log('=== 历史版本视图的实际文本 ===')
  console.log(main.slice(0, 1200))
  console.log('=== 按钮/可点元素 ===')
  const btns = await p.eval(`JSON.stringify([...document.querySelectorAll('.kb-main button, .kb-main [role="button"], .kb-main a')]
    .map(e => ({ t: (e.textContent||'').trim().slice(0,20), aria: e.getAttribute('aria-label')||'', cls: e.className.split(' ').slice(0,2).join('.') }))
    .filter(x => x.t || x.aria))`)
  console.log(btns)
  // 点第一个版本看看是否出现回滚
  const clicked = await p.eval(`(() => {
    const el = [...document.querySelectorAll('.kb-main *')].find(e => /^v\\d+/.test((e.textContent||'').trim()) && e.children.length <= 2);
    if (!el) return false; el.click(); return true;
  })()`)
  await sleep(1200)
  if (clicked) {
    const after = await p.eval(`(document.querySelector('.kb-main') || document.body).innerText`)
    console.log('=== 点选版本后的文本（找「回滚」）===')
    console.log(after.includes('回滚') ? '含「回滚」✅' : '仍不含「回滚」❌')
    const idx = after.indexOf('回滚')
    console.log(idx >= 0 ? after.slice(Math.max(0, idx - 60), idx + 40) : after.slice(0, 500))
  }
} finally {
  await b.close()
}

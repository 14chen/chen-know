import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const APP = (process.argv[2] || 'http://127.0.0.1:8090').replace(/\/$/, '')
const USER = process.argv[3]
const PWD = process.argv[4] || 'E2ePass!2345'

const b = await launch({ width: 1440, height: 900 })
try {
  const p = await b.newPage(APP + '/')
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 20000 })
  await p.eval(`(() => {
    const u = document.querySelector('input[name="username"]');
    const pw = document.querySelector('input[name="password"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(u, ${JSON.stringify(USER)}); u.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(pw, ${JSON.stringify(PWD)}); pw.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor(`!!document.querySelector('.kb-app')`, { timeout: 30000 })
  await sleep(2500)

  console.log('=== 侧栏内的所有 button（含 aria-label / title / class）===')
  console.log(await p.eval(`JSON.stringify([...document.querySelectorAll('.kb-sidebar button')].map(x => ({
    aria: x.getAttribute('aria-label'), title: x.getAttribute('title'),
    cls: String(x.className).slice(0, 50),
    txt: (x.textContent || '').trim().slice(0, 16),
    w: Math.round(x.getBoundingClientRect().width)
  })), null, 1)`))
  console.log('\n=== 侧栏顶层结构（class 名）===')
  console.log(await p.eval(`(() => {
    const sb = document.querySelector('.kb-sidebar');
    const walk = (el, d = 0) => {
      if (d > 3) return '';
      return [...el.children].map(c =>
        '  '.repeat(d) + c.tagName.toLowerCase() + '.' + String(c.className).split(' ').slice(0,3).join('.') +
        (c.tagName === 'BUTTON' ? ' [aria=' + (c.getAttribute('aria-label')||'') + ']' : '') + '\\n' +
        walk(c, d + 1)
      ).join('');
    };
    return walk(sb);
  })()`))
  console.log('\n=== 侧栏文本 ===')
  console.log((await p.eval(`document.querySelector('.kb-sidebar').innerText`)).slice(0, 400))
} finally {
  await b.close()
}

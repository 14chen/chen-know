// 生成带标注的手册截图：在页面里注入编号高亮框再截图，坐标由 getBoundingClientRect 实时取得。
// 比事后用图像库画框可靠 —— 不会因为布局变化而错位。
import { launch } from './cdp.mjs'
import { mkdirSync } from 'node:fs'

const APP_URL = process.argv[2] || 'http://127.0.0.1:8080/'
const OUT = 'D:/deepseekhums/work/知识库/docs/images'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const b = await launch({ width: 1440, height: 900, scale: 2 })
try {
  const p = await b.newPage(APP_URL)
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 30000 })
  await sleep(800)

  // 标注工具：所有注入元素都带 data-kbmark，清理时按属性删 —— 
  // 早先用 `[style*="999999"]` 匹配会漏掉，残留的 fixed 定位框会落在后续页面内容上（实测出现过）。
  const installMarker = () =>
    p.eval(`(() => {
  window.__kbmark = (items) => {
    document.querySelectorAll('[data-kbmark]').forEach(e => e.remove());
    let n = 0;
    for (const it of items) {
      const el = typeof it.el === 'string' ? document.querySelector(it.el) : it.el;
      if (!el) { console.warn('marker target missing:', it.label); continue; }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const box = document.createElement('div');
      box.setAttribute('data-kbmark', '1');
      Object.assign(box.style, {
        position: 'fixed', left: (r.left + 2) + 'px', top: (r.top + 2) + 'px',
        width: (r.width - 4) + 'px', height: (r.height - 4) + 'px',
        border: '3px solid #ef4444', borderRadius: '10px',
        pointerEvents: 'none', zIndex: '2147483000',
      });
      document.body.append(box);
      if (it.n) {
        const badge = document.createElement('div');
        badge.setAttribute('data-kbmark', '1');
        Object.assign(badge.style, {
          position: 'fixed', left: (r.left + 8) + 'px', top: (r.top + 8) + 'px',
          width: '28px', height: '28px', borderRadius: '14px', background: '#ef4444', color: '#fff',
          font: '700 16px/28px system-ui', textAlign: 'center',
          pointerEvents: 'none', zIndex: '2147483001',
        });
        badge.textContent = String(it.n);
        document.body.append(badge);
      }
      n++;
    }
    return n;
  };
  window.__kbclear = () => {
    const k = document.querySelectorAll('[data-kbmark]').length;
    document.querySelectorAll('[data-kbmark]').forEach(e => e.remove());
    return k;
  };
  return true;
})()`)

  await installMarker()

  // ---- 登录页 ----
  const nLogin = await p.eval(`window.__kbmark([
    { el: 'input[name="username"]', n: 1 },
    { el: 'input[name="password"]', n: 2 },
    { el: [...document.querySelectorAll('button')].find(x => x.textContent.includes('登录')), n: 3 },
  ])`)
  console.log(`  登录页注入 ${nLogin} 个标注`)
  await sleep(400)
  await p.screenshot(`${OUT}/02-登录页-标注.png`)
  console.log('  ✓ 02-登录页-标注.png')
  const cleared1 = await p.eval(`window.__kbclear()`)
  console.log(`  清理 ${cleared1} 个标注元素`)

  // 登录
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
  await sleep(2200)

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
  // 主界面：标注三大区域
  await goto('#/notes/1')
  await clickLine(await lastLine())
  await sleep(800)
  const nMain = await p.eval(`window.__kbmark([
    { el: '.kb-topbar', n: 1 },
    { el: '.kb-sidebar [class*="tree"]', n: 2 },
    { el: '.kb-editor-region', n: 3 },
  ])`)
  console.log(`  主界面注入 ${nMain} 个标注`)
  await sleep(400)
  await p.screenshot(`${OUT}/03-主界面-标注.png`)
  console.log('  ✓ 03-主界面-标注.png')
  console.log(`  清理 ${await p.eval(`window.__kbclear()`)} 个标注元素`)

  // Typora 对比：只框住「光标所在的那一行」
  await clickLine(0)
  await sleep(800)
  const nLine = await p.eval(`(() => {
    const line = document.querySelectorAll('.cm-line')[0];
    if (!line) return 0;
    return window.__kbmark([{ el: line }]);
  })()`)
  console.log(`  标题行注入 ${nLine} 个标注`)
  await sleep(400)
  await p.screenshot(`${OUT}/04-光标在标题行-标注.png`)
  console.log('  ✓ 04-光标在标题行-标注.png')
  console.log(`  清理 ${await p.eval(`window.__kbclear()`)} 个标注元素`)

  // 搜索页：标注搜索框与结果区
  await goto('#/search?q=%E5%A4%A9%E6%B0%94')
  const nSearch = await p.eval(`window.__kbmark([
    { el: '.kb-search', n: 1 },
    { el: '.kb-main', n: 2 },
  ])`)
  console.log(`  搜索页注入 ${nSearch} 个标注`)
  await sleep(400)
  await p.screenshot(`${OUT}/07-搜索-标注.png`)
  console.log('  ✓ 07-搜索-标注.png')
  console.log(`  清理 ${await p.eval(`window.__kbclear()`)} 个标注元素`)

  console.log(`\n完成，输出目录：${OUT}`)
} finally {
  await b.close()
}

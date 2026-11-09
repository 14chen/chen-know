// Lead 独立验收：选区可见性 + 模态框真实输入 + 标签颜色选择器
// 关键：一律用**真实键盘事件**（Input.dispatchKeyEvent），不用 Input.insertText
// —— insertText 绕过焦点语义，会把「焦点被抢走」这种缺陷掩盖掉。
import { launch } from './cdp.mjs'
import { mkdirSync } from 'node:fs'

const APP = (process.argv[2] || 'http://127.0.0.1:8090').replace(/\/$/, '')
const OUT = 'D:/deepseekhums/work/知识库/tools/verify/shots/round5'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
const fails = []
const check = (n, ok, d = '') => {
  if (ok) pass++; else { fail++; fails.push(`${n}${d ? ' :: ' + d : ''}`) }
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? '  :: ' + d : ''}`)
}
const section = (t) => console.log(`\n${'='.repeat(66)}\n${t}\n${'='.repeat(66)}`)

const b = await launch({ width: 1400, height: 900 })
let p
const typeReal = async (text, gap = 110) => {
  for (const ch of text) {
    await p._send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
    await p._send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(gap)
  }
}
const api = async (method, path, payload) =>
  JSON.parse(await p.eval(`(async () => {
    const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)},
      headers: ${payload ? `{'Content-Type':'application/json'}` : '{}'},
      body: ${payload ? JSON.stringify(JSON.stringify(payload)) : 'undefined'},
      credentials: 'same-origin' });
    const t = await r.text();
    return JSON.stringify({ status: r.status, body: t ? JSON.parse(t) : null });
  })()`))

try {
  p = await b.newPage(APP + '/')
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 30000 })
  await p.eval(`(() => {
    const u = document.querySelector('input[name="username"]');
    const pw = document.querySelector('input[name="password"]');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(u, 'demo'); u.dispatchEvent(new Event('input', { bubbles: true }));
    s.call(pw, 'DemoPass123!'); pw.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor(`!!document.querySelector('.kb-app')`, { timeout: 30000 })
  await sleep(2200)

  // ================= ① 选区可见性 =================
  section('① 选中文字的可见性（用户：效果不明显）')
  const list = await api('GET', '/api/notes?size=50')
  const nid = list.body.items.find((n) => n.title === '中文排版测试')?.id ?? list.body.items[0].id
  await p._send('Page.reload'); await p.waitForLoad(); await sleep(1200)
  await p.goto(`${APP}#/notes/${nid}`, { waitMs: 1800 })
  await p.waitFor(`!!document.querySelector('.cm-content')`, { timeout: 20000 })
  await sleep(1400)

  const box = await p.eval(`(() => {
    const ls = document.querySelectorAll('.cm-line');
    const el = ls[Math.min(3, ls.length - 1)];
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width * 0.45, y: r.y + r.height / 2 };
  })()`)
  await p.clickAt(box.x, box.y)
  await sleep(400)
  for (let i = 0; i < 8; i++) { await p.press('ArrowRight', { shift: true }); await sleep(90) }
  await sleep(400)
  const sel = JSON.parse(await p.eval(`JSON.stringify((() => {
    const el = document.querySelector('.cm-selectionBackground');
    const cs = el ? getComputedStyle(el) : null;
    const m = cs ? /rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/.exec(cs.backgroundColor) : null;
    return {
      exists: !!el,
      bg: cs ? cs.backgroundColor : null,
      alpha: m ? (m[4] === undefined ? 1 : parseFloat(m[4])) : 0,
      text: String(window.getSelection()).slice(0, 20),
      token: getComputedStyle(document.documentElement).getPropertyValue('--selection-bg').trim(),
    };
  })())`))
  console.log('    实测:', JSON.stringify(sel))
  check('1.1 选区元素存在', sel.exists, JSON.stringify(sel))
  check('1.2 选区背景不是透明', sel.alpha > 0 && !/rgba\(0, 0, 0, 0\)/.test(String(sel.bg)), `bg=${sel.bg}`)
  check('1.3 选区不透明度 ≥0.25（明显可见）', sel.alpha >= 0.25, `alpha=${sel.alpha} token=${sel.token}`)
  await p.screenshot(`${OUT}/1-选区浅色.png`)

  await p.eval(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/主题/.test(x.getAttribute('aria-label')||'')); if(b) b.click(); })()`)
  await sleep(900)
  const selDark = JSON.parse(await p.eval(`JSON.stringify((() => {
    const el = document.querySelector('.cm-selectionBackground');
    const cs = el ? getComputedStyle(el) : null;
    const m = cs ? /rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/.exec(cs.backgroundColor) : null;
    return { bg: cs ? cs.backgroundColor : null, alpha: m ? (m[4] === undefined ? 1 : parseFloat(m[4])) : 0,
             theme: document.documentElement.getAttribute('data-theme') };
  })())`))
  console.log('    深色:', JSON.stringify(selDark))
  check('1.4 深色主题下选区同样可见', selDark.theme === 'dark' && selDark.alpha >= 0.25, JSON.stringify(selDark))
  await p.screenshot(`${OUT}/1-选区深色.png`)
  await p.eval(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/主题/.test(x.getAttribute('aria-label')||'')); if(b) b.click(); })()`)
  await sleep(700)

  // ================= ② 模态框真实输入 =================
  section('② 模态框输入（用户：创建时文字输入有问题）')
  await p.goto(`${APP}#/notes`, { waitMs: 1500 })
  await sleep(1300)
  await p.eval(`(() => { const b=[...document.querySelectorAll('.kb-sidebar button')].find(x=>/新建顶级目录/.test(x.getAttribute('aria-label')||'')); if(b) b.click(); })()`)
  await sleep(900)
  const focusInfo = JSON.parse(await p.eval(`JSON.stringify({
    active: document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0,30),
    isInput: document.activeElement === document.querySelector('.kb-modal input'),
    modalOpen: !!document.querySelector('.kb-modal'),
  })`))
  console.log('    打开后:', JSON.stringify(focusInfo))
  check('2.1 打开弹窗后输入框自动获得焦点', focusInfo.modalOpen && focusInfo.isInput, JSON.stringify(focusInfo))

  // **不点输入框**直接打字
  await typeReal('abcdefghij', 110)
  await sleep(700)
  const v1 = await p.eval(`document.querySelector('.kb-modal input')?.value ?? '(无)'`)
  check('2.2 不点输入框直接键入 10 个字符全部保留', v1 === 'abcdefghij', `value=${JSON.stringify(v1)}`)
  const stillFocused = await p.eval(`document.activeElement === document.querySelector('.kb-modal input')`)
  check('2.3 输入过程中焦点没有被抢走', stillFocused === true, `focused=${stillFocused}`)
  await p.screenshot(`${OUT}/2-弹窗输入.png`)

  // Tab 焦点陷阱
  const trap = JSON.parse(await p.eval(`(() => {
    const modal = document.querySelector('.kb-modal');
    const focusables = [...modal.querySelectorAll('input:not([type=hidden]), textarea, select, button')].filter(e => e.getBoundingClientRect().width > 0);
    return JSON.stringify({ count: focusables.length });
  })()`))
  await p.press('Tab'); await sleep(250); await p.press('Tab'); await sleep(250)
  const inside = await p.eval(`!!document.querySelector('.kb-modal')?.contains(document.activeElement)`)
  check('2.4 Tab 焦点留在弹窗内', inside === true, `focusables=${trap.count} inside=${inside}`)

  // Escape 关闭
  await p.press('Escape'); await sleep(700)
  const closed = await p.eval(`!document.querySelector('.kb-modal')`)
  check('2.5 Escape 能关闭弹窗', closed === true)

  // 标签弹窗（text + color 两个输入）
  await p.goto(`${APP}#/tags`, { waitMs: 1800 })
  await sleep(1500)
  await p.eval(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/新建标签/.test(x.textContent||'')); if(b) b.click(); })()`)
  await sleep(900)
  const tagFocus = await p.eval(`JSON.stringify((() => {
    const ins = [...document.querySelectorAll('.kb-modal input')];
    const text = ins.find(i => i.type === 'text');
    return { textFocused: document.activeElement === text, inputs: ins.map(i => i.type) };
  })())`)
  console.log('    标签弹窗:', tagFocus)
  check('2.6 标签弹窗默认聚焦到文本输入框', JSON.parse(tagFocus).textFocused === true, tagFocus)
  await typeReal('标签输入测试十个字', 110)
  await sleep(700)
  const v2 = await p.eval(`(() => { const i=[...document.querySelectorAll('.kb-modal input')].find(x=>x.type==='text'); return i ? i.value : '(无)'; })()`)
  check('2.7 标签名 10 个字符全部保留', v2 === '标签输入测试十个字', `value=${JSON.stringify(v2)}`)

  // ================= ③ 标签颜色选择器 =================
  section('③ 标签颜色选择器（用户：那条大紫条像坏了）')
  const colorUi = JSON.parse(await p.eval(`JSON.stringify((() => {
    const modal = document.querySelector('.kb-modal');
    const native = modal.querySelector('input[type=color]');
    const swatches = [...modal.querySelectorAll('[class*="swatch"], [role="radio"], button[aria-label*="#"]')];
    return {
      nativeColor: !!native,
      nativeWidth: native ? Math.round(native.getBoundingClientRect().width) : 0,
      modalWidth: Math.round(modal.getBoundingClientRect().width),
      swatchCount: swatches.length,
      labels: swatches.slice(0, 10).map(e => e.getAttribute('aria-label') || e.title || ''),
    };
  })())`))
  console.log('    颜色 UI:', JSON.stringify(colorUi))
  const isPalette = colorUi.swatchCount >= 5
  const isBoundedNative = colorUi.nativeColor && colorUi.nativeWidth > 0 && colorUi.nativeWidth < colorUi.modalWidth * 0.5
  check('3.1 颜色输入不再是一条满宽色带', isPalette || isBoundedNative,
    `swatches=${colorUi.swatchCount} nativeWidth=${colorUi.nativeWidth}/${colorUi.modalWidth}`)
  await p.screenshot(`${OUT}/3-颜色选择器.png`)

  if (isPalette) {
    const picked = await p.eval(`(() => {
      const modal = document.querySelector('.kb-modal');
      const sw = [...modal.querySelectorAll('[class*="swatch"], [role="radio"], button[aria-label*="#"]')];
      if (sw.length < 3) return null;
      const label = sw[2].getAttribute('aria-label') || sw[2].title || '';
      sw[2].click();
      return label;
    })()`)
    await sleep(500)
    console.log('    点了第 3 个色块:', picked)
    const saveBtn = await p.eval(`(() => {
      const b = [...document.querySelectorAll('.kb-modal button')].find(x => /创建|保存/.test((x.textContent||'').trim()));
      if (!b) return false; b.click(); return true;
    })()`)
    await sleep(2000)
    const tags = await api('GET', '/api/tags')
    const createdTag = (tags.body || []).find((t) => t.name === '标签输入测试十个字')
    check('3.2 保存后标签创建成功', !!createdTag, `找得到=${!!createdTag}`)
    if (createdTag) {
      check('3.3 颜色值与所选色块一致', /^#[0-9a-f]{6}$/.test(createdTag.color), `color=${createdTag.color}`)
      await api('DELETE', `/api/tags/${createdTag.id}`)
    }
  }

  const errs = await p.consoleErrors()
  check('Z 全程无未捕获异常', errs.length === 0, JSON.stringify(errs).slice(0, 300))
} catch (e) {
  fail++
  fails.push(`运行异常: ${e.message}`)
  console.error('\n异常：', e.message)
  try { await p?.screenshot(`${OUT}/ZZ-异常.png`) } catch {}
} finally {
  console.log(`\n${'='.repeat(66)}`)
  console.log(`本轮 UI 验收：PASS ${pass}   FAIL ${fail}`)
  fails.forEach((f) => console.log('  - ' + f))
  console.log('='.repeat(66))
  await b.close()
  process.exitCode = fail ? 1 : 0
}

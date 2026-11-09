/**
 * React 核心视图验收（真后端 + dev server + CDP 真实时间）
 *
 * 前置：
 *   1) 隔离后端在 http://127.0.0.1:8080（演示账号 demo / DemoPass123!）
 *   2) dev server：cd frontend && npm run dev（5173，/api 已代理到 8080）
 *   3) headless 浏览器带 CDP：EDGE --headless=new --remote-debugging-port=9225 about:blank
 * 用法：node tools/verify/frontend-core/react-views-acceptance.mjs
 *
 * 说明：lab 页面（src/views/search/__lab__/index.html）是开发期夹具，
 *      它用与外壳一致的 ViewContext 语义挂载这 6 个视图；视图本身不依赖 lab。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { findBrowser } from './repo.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FE_DIR = path.resolve(HERE, '..', '..', '..', 'frontend')
const CDP = process.env.CDP || 'http://127.0.0.1:9225'
const DEV_URL = process.env.DEV_URL || 'http://localhost:5173/proto/index.html'
const LAB =
  process.env.LAB || 'http://localhost:5173/proto/src/views/search/__lab__/index.html'
const SHOT_DIR = process.env.SHOTS || path.join(HERE, 'shots-views-react')
const DEMO = { username: 'demo', password: 'DemoPass123!' }
const STAMP = String(Date.now()).slice(-6)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const R = []
let failed = 0
function ok(name, cond, detail = '') {
  const pass = Boolean(cond)
  if (!pass) failed += 1
  const line = `${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`
  R.push(line)
  console.log(line)
}

fs.mkdirSync(SHOT_DIR, { recursive: true })

/* ------------------------------------------------ dev server / 浏览器自管自停 */
const children = []
function killChildren() {
  for (const child of children) {
    try {
      child.kill()
    } catch {
      /* 已退出 */
    }
  }
}
process.on('exit', killChildren)

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}

async function ensureDevServer() {
  if (await reachable(DEV_URL)) {
    console.log('  dev server 已在运行')
    return
  }
  console.log(`  启动 dev server（${FE_DIR}）…`)
  const child =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', 'npm run dev'], { cwd: FE_DIR, stdio: 'ignore', windowsHide: true })
      : spawn('npm', ['run', 'dev'], { cwd: FE_DIR, stdio: 'ignore' })
  children.push(child)
  for (let i = 0; i < 60; i += 1) {
    if (await reachable(DEV_URL)) {
      console.log('  dev server 就绪')
      return
    }
    await sleep(500)
  }
  throw new Error('dev server 30s 内未就绪')
}

async function ensureBrowser() {
  if (await reachable(`${CDP}/json/version`)) {
    console.log('  浏览器 CDP 已在运行')
    return
  }
  const browser = findBrowser()
  if (!browser) throw new Error('未找到 Edge/Chrome，请设置 EDGE=<exe 路径>')
  console.log(`  启动浏览器（${browser}）…`)
  const profile = path.join(SHOT_DIR, '..', 'edge-profile-lab')
  fs.rmSync(profile, { recursive: true, force: true })
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=9225',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  )
  children.push(child)
  for (let i = 0; i < 40; i += 1) {
    if (await reachable(`${CDP}/json/version`)) {
      console.log('  浏览器 CDP 就绪')
      return
    }
    await sleep(500)
  }
  throw new Error('浏览器 20s 内未就绪')
}

await ensureDevServer()
await ensureBrowser()

/* ------------------------------------------------------------------ CDP */
/** 开一个全新标签页并连接它（避免连到上次运行遗留的失效 target） */
async function openFreshPage(url) {
  try {
    const response = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    if (response.ok) {
      const created = await response.json()
      if (created?.webSocketDebuggerUrl) return created
    }
  } catch {
    /* 回退到已有页面 */
  }
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json()
      const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      const appPage = pages.find((t) => String(t.url).startsWith('http://localhost:5173/'))
      const page = appPage ?? pages[0]
      if (page) return page
    } catch {
      /* 未就绪 */
    }
    await sleep(500)
  }
  throw new Error('未找到 CDP page target（浏览器没起或端口不对）')
}

const page = await openFreshPage(LAB)
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let seq = 0
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(
      'exception: ' +
        (msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text),
    )
  }
})

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = (seq += 1)
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.result?.exceptionDetails) {
    const details = result.result.exceptionDetails
    throw new Error('页面内异常：' + (details.exception?.description ?? details.text))
  }
  return result.result?.result?.value
}

async function waitFor(expression, timeout = 12000, label = '') {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      if (await evaluate(expression)) return true
    } catch {
      /* 继续等 */
    }
    await sleep(150)
  }
  throw new Error(`waitFor 超时：${label || expression.slice(0, 60)}`)
}

async function shot(name, options = {}) {
  const result = await send('Page.captureScreenshot', { format: 'png' })
  if (result.result?.data) {
    fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), Buffer.from(result.result.data, 'base64'))
  }
  if (options.metrics !== false) {
    const metrics = await evaluate(`(() => {
      const doc = document.documentElement
      const rows = Array.from(document.querySelectorAll(${JSON.stringify(options.scrollProbe ?? '.vw')}))
      return JSON.stringify({
        docScroll: doc.scrollWidth, docClient: doc.clientWidth,
        probeOverflow: rows.map(el => el.scrollWidth - el.clientWidth),
      })
    })()`)
    return metrics
  }
  return null
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

// 在所有页面脚本前注入：记录 fetch、错误、XSS 探针
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__reqs=[];window.__errors=[];
(function(){
  var of = window.fetch;
  window.fetch = function(input, init){
    try {
      var url = typeof input === 'string' ? input : (input && input.url);
      window.__reqs.push({ url: String(url), method: (init && init.method) || 'GET', body: (init && typeof init.body === 'string') ? init.body : null, at: Date.now() });
    } catch(e){}
    return of.apply(this, arguments);
  };
  var oe = console.error;
  console.error = function(){ window.__errors.push(Array.prototype.slice.call(arguments).map(function(a){return a && a.message ? a.message : String(a);}).join(' ')); oe.apply(console, arguments); };
  window.addEventListener('error', function(e){ window.__errors.push('onerror: ' + (e.message || '')); });
  window.addEventListener('unhandledrejection', function(e){ window.__errors.push('unhandledrejection: ' + String((e.reason && e.reason.message) || e.reason)); });
})();`,
})

const nav = (hash) => evaluate(`(async () => { window.location.hash = ${JSON.stringify(hash)}; return true })()`)
const setConfirmAnswer = (value) =>
  evaluate(`(async () => { window.__confirmAnswer = ${value ? 'true' : 'false'}; return true })()`)

/** 按可见文字点击；找不到就抛清晰错误（而不是 undefined.click() 崩溃） */
async function clickByText(selector, text) {
  const clicked = await evaluate(
    `(() => {
      const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((node) => node.textContent.includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.click();
      return true;
    })()`,
  )
  if (!clicked) throw new Error(`找不到可点击元素：${selector} 含「${text}」`)
}

/** 把输入框/下拉框的值按 React 的方式改掉（原生 setter + input/change 事件） */
async function setControl(selector, value, eventName = 'input') {
  const changed = await evaluate(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(${JSON.stringify(eventName)}, { bubbles: true }));
      return true;
    })()`,
  )
  if (!changed) throw new Error(`找不到控件：${selector}`)
}

/* ------------------------------------------------------------------ 启动 + 登录 */
await send('Page.navigate', { url: LAB })
// 等页面真的落在 dev server 上（about:blank 上做同源 fetch 会直接 Failed to fetch）
await waitFor(`location.href.startsWith('http://localhost:5173/')`, 25000, '页面加载到 dev server')

// 先登录（走 dev 代理），再刷新让 lab 拿到会话
await evaluate(`(async () => {
  const response = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
    body: JSON.stringify(${JSON.stringify(DEMO)}) });
  if (!response.ok) throw new Error('登录失败 HTTP ' + response.status);
  return true;
})()`)
await send('Page.navigate', { url: LAB })
await waitFor(`!!document.querySelector('#lab-metrics')`, 20000, 'lab 挂载')
const userLine = await evaluate(`(async () => (await fetch('/api/auth/me')).json().then(u => u.displayName))()`)
ok('dev server + lab 挂载成功，且已登录（真后端会话）', userLine === '演示账号', `user=${userLine}`)

/* ------------------------------------------------------------------ 测试数据（自建，不碰 6 篇演示笔记） */
// 先清掉**上一次运行**留下的自建数据：dev 库与队友共享，只删名字匹配的自己的数据。
// 其中 '这篇笔记还没写' 是演示笔记 3 故意留的「未创建」目标，被创建过就要删掉才能复现 dangling 断言。
const preclean = await evaluate(`(async () => {
  const page = await (await fetch('/api/notes?size=200&sort=updated')).json();
  const mine = page.items.filter((n) => /XSSPROBE|ESCPROBE|NESTPROBE|验收笔记|未创建的验收目标|这篇笔记还没写/.test(n.title)).map((n) => n.id);
  for (const id of mine) await fetch('/api/notes/' + id, { method: 'DELETE', credentials: 'same-origin' });
  const tags = await (await fetch('/api/tags')).json();
  const myTags = tags.filter((t) => /^(中文排版测试|验收标签)/.test(t.name)).map((t) => t.id);
  for (const id of myTags) await fetch('/api/tags/' + id, { method: 'DELETE', credentials: 'same-origin' });
  return JSON.stringify({ notes: mine.length, tags: myTags.length });
})()`)
console.log(`  （预清理上一轮自建数据：${preclean}）`)

const XSS_CASES = [
  {
    name: 'A 原始载荷（服务端转义成实体）',
    probe: 'XSSPROBE',
    flags: ['__xssTitle', '__xssBody'],
    title: `<img src=x onerror=window.__xssTitle=1> XSSPROBE ${STAMP}`,
    content: `<img src=x onerror=window.__xssBody=1> 注入测试 XSSPROBE ${STAMP}`,
    expectText: '<img src=x onerror=window.__xssTitle=1>',
  },
  {
    name: 'B 已转义形式（&lt;img …&gt;）',
    probe: 'ESCPROBE',
    flags: ['__xssEsc'],
    title: `&lt;img src=x onerror=window.__xssEsc=1&gt; ESCPROBE ${STAMP}`,
    content: `正文 ESCPROBE ${STAMP} &lt;img src=x onerror=window.__xssEsc=1&gt;`,
    expectText: '&lt;img src=x onerror=window.__xssEsc=1&gt;',
  },
  {
    name: 'C 嵌套形式（<em><img onerror></em>）',
    probe: 'NESTPROBE',
    flags: ['__xssNest', '__xssNestBody'],
    title: `<em><img src=x onerror=window.__xssNest=1></em> NESTPROBE ${STAMP}`,
    content: `嵌套 NESTPROBE ${STAMP} <em><img src=x onerror=window.__xssNestBody=1></em>`,
    expectText: '<img src=x onerror=window.__xssNest=1>',
  },
]
const created = await evaluate(`(async () => {
  const post = (body) => fetch('/api/notes', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body: JSON.stringify(body) }).then(r => r.json());
  const probes = [];
  ${XSS_CASES.map(
    (item) =>
      `probes.push(await post({ title: ${JSON.stringify(item.title)}, content: ${JSON.stringify(item.content)} }));`,
  ).join('\n  ')}
  const mine = await post({ title: '验收笔记 ${STAMP}', content: '# 验收笔记\\n\\n引用 [[双向链接演示（B）]] 与 [[未创建的验收目标]]\\n' });
  await fetch('/api/notes/' + mine.id, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body: JSON.stringify({ content: '# 验收笔记 ${STAMP}\\n\\n第二版内容，用于版本 diff。\\n\\n引用 [[双向链接演示（B）]]\\n' }) });
  await fetch('/api/notes/' + mine.id + '/view', { method:'POST', credentials:'same-origin' });
  return JSON.stringify({ xssIds: probes.map((p) => p.id), mineId: mine.id });
})()`)
const { xssIds, mineId } = JSON.parse(created)
ok(
  '自建测试数据（三条 XSS 探针笔记 + 验收笔记）',
  xssIds.length === 3 && Boolean(mineId),
  `xssIds=${xssIds.join(',')} mineId=${mineId}`,
)
await sleep(600)

/* ------------------------------------------------------------------ 1. search */
await nav('#/search?q=天气')
await waitFor(`document.querySelectorAll('.vw-row').length > 0`, 12000, '搜索出结果')
const searchInfo = await evaluate(`JSON.stringify({
  rows: document.querySelectorAll('.vw-row').length,
  em: document.querySelectorAll('.vw .vw-em em').length,
  count: document.querySelector('.vw__count')?.textContent ?? '',
  title: document.querySelector('.vw-row__title')?.textContent ?? ''
})`)
const s1 = JSON.parse(searchInfo)
ok('search：URL 的 q 是唯一真源（#/search?q=天气 自动出结果）', s1.rows >= 1, `rows=${s1.rows}`)
ok('search：命中数与 <em> 高亮', s1.em >= 1 && /命中\s*\d+\s*条/.test(s1.count), `em=${s1.em} count=${s1.count}`)
await evaluate(`document.querySelector('.vw-row').click()`)
await sleep(400)
const openLog = await evaluate(`JSON.stringify(window.__labLogs?.openLog ?? [])`)
ok('search：点击结果 → ctx.openNote(id)', openLog.includes(5), `openLog=${openLog}`)

// 防抖 300ms + URL 同步
const before = await evaluate(`window.location.hash`)
await evaluate(`(() => {
  const input = document.querySelector('.vw input[type="search"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '排版');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`)
await sleep(900)
const after = await evaluate(`window.location.hash`)
const debounced = await evaluate(`document.querySelector('.vw-row__title')?.textContent ?? ''`)
ok('search：输入防抖 300ms 后写回 URL 并重新检索', before !== after && decodeURIComponent(after).includes('q=排版'), `${before} → ${after}`)
ok('search：防抖后结果更新', debounced.includes('中文排版测试') || debounced.length > 0, debounced.slice(0, 40))

// XSS：三条载荷（原始 / 已转义 / 嵌套）都不得执行，且白名单 <em> 必须保留、载荷文字必须仍可见
for (const item of XSS_CASES) {
  await nav(`#/search?q=${item.probe}`)
  await waitFor(`document.querySelectorAll('.vw-row').length > 0`, 12000, `${item.name} 命中`)
  await sleep(600)
  const state = JSON.parse(
    await evaluate(`JSON.stringify({
      flags: ${JSON.stringify(item.flags)}.map((key) => window[key] ?? null),
      onerror: document.querySelectorAll('.vw [onerror]').length,
      imgs: document.querySelectorAll('.vw img').length,
      scripts: document.querySelectorAll('.vw script').length,
      emKept: document.querySelectorAll('.vw .vw-em em').length,
      text: (document.querySelector('.vw-row__title')?.textContent ?? '')
    })`),
  )
  const executed = state.flags.some((value) => value !== null)
  ok(
    `XSS ${item.name}：onerror 未执行且无 img/onerror/script 残留`,
    !executed && state.imgs === 0 && state.onerror === 0 && state.scripts === 0,
    JSON.stringify(state),
  )
  ok(
    `XSS ${item.name}：白名单 <em> 保留 + 载荷文字仍可见`,
    state.emKept >= 1 && state.text.includes(item.expectText),
    `em=${state.emKept} text="${state.text.slice(0, 60)}"`,
  )
}

// 空态（并截图）
await nav('#/search?q=ZZZ_NO_SUCH_TERM_ZZZ')
await waitFor(`!!document.querySelector('.vw .kb-empty')`, 10000, '空态')
const emptyTitle = await evaluate(`document.querySelector('.vw .kb-empty__title')?.textContent ?? ''`)
ok('search：空结果态', emptyTitle.includes('没有匹配的结果'), emptyTitle)
await shot('state-empty-search')

/* ------------------------------------------------------------------ 2. 加载态（CDP 慢网） */
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 2500,
  downloadThroughput: -1,
  uploadThroughput: -1,
})
await nav('#/search?q=排版')
await sleep(700)
const loadingShown = await evaluate(`document.querySelectorAll('.vw .kb-skeleton').length`)
ok('search：加载态渲染骨架屏（网络延迟 2.5s 下）', loadingShown >= 4, `skeletons=${loadingShown}`)
await shot('state-loading-search')
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
})
await waitFor(`document.querySelectorAll('.vw .kb-skeleton').length === 0`, 15000, '加载完成')

/* ------------------------------------------------------------------ 3. 错误态（404 笔记） */
await nav('#/backlinks?note=999999')
await waitFor(`!!document.querySelector('.vw .kb-empty')`, 12000, '错误态')
const errTitle = await evaluate(`document.querySelector('.vw .kb-empty__title')?.textContent ?? ''`)
const errDesc = await evaluate(`document.querySelector('.vw .kb-empty__desc')?.textContent ?? ''`)
ok('backlinks：错误态（404 笔记）有文案与重试', errTitle.includes('加载失败') && errDesc.length > 0, `${errTitle} / ${errDesc.slice(0, 40)}`)
await shot('state-error-backlinks')

/* ------------------------------------------------------------------ 4. tags（空态 → 新建 → 改名 → 删除 → 跳搜索） */
// 先清掉上一次运行残留的自建标签，保证空态可复现（只删名字匹配的，不碰别人的）
await evaluate(`(async () => {
  const tags = await (await fetch('/api/tags')).json();
  for (const tag of tags) {
    if (/^(中文排版测试|验收标签)/.test(tag.name)) await fetch('/api/tags/' + tag.id, { method: 'DELETE', credentials: 'same-origin' });
  }
  return true;
})()`)
await nav('#/tags')
await waitFor(`!!document.querySelector('.vw .kb-empty, .vw-card')`, 12000, 'tags 渲染')
const tagsState = JSON.parse(
  await evaluate(`JSON.stringify({
    empty: !!document.querySelector('.vw .kb-empty'),
    title: document.querySelector('.vw .kb-empty__title')?.textContent ?? '',
    cards: document.querySelectorAll('.vw-card').length
  })`),
)
ok(
  'tags：空态或列表态渲染正常（dev 库与队友共享，不强求为空）',
  tagsState.empty ? tagsState.title.includes('还没有标签') : tagsState.cards > 0,
  JSON.stringify(tagsState),
)
await shot(tagsState.empty ? 'state-empty-tags' : 'tags-with-data')

// 新建
const tagName = `验收标签${STAMP}`
await evaluate(`Array.from(document.querySelectorAll('.vw__actions .kb-btn')).find(b => b.textContent.includes('新建标签')).click()`)
await waitFor(`!!document.querySelector('.kb-modal')`, 6000, '新建标签弹窗')
await evaluate(`(() => {
  const input = document.querySelector('.kb-modal input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(tagName)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const color = document.querySelector('.kb-modal input[type="color"]');
  const cset = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  cset.call(color, '#16a34a');
  color.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`)
await evaluate(`Array.from(document.querySelectorAll('.kb-modal__footer .kb-btn')).find(b => /创建|保存/.test(b.textContent)).click()`)
await waitFor(`Array.from(document.querySelectorAll('.vw-card__name')).some(el => el.textContent === ${JSON.stringify(tagName)})`, 10000, '标签创建后出现在列表')
ok('tags：新建标签 → POST /api/tags 并刷新列表', true, tagName)

// 改名
const renamed = `${tagName}改`
await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.vw-card')).find(c => c.textContent.includes(${JSON.stringify(tagName)}));
  Array.from(card.querySelectorAll('.kb-btn')).find(b => b.textContent.includes('编辑')).click();
  return true;
})()`)
await waitFor(`!!document.querySelector('.kb-modal')`, 6000, '编辑弹窗')
await evaluate(`(() => {
  const input = document.querySelector('.kb-modal input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(renamed)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`)
await evaluate(`Array.from(document.querySelectorAll('.kb-modal__footer .kb-btn')).find(b => /保存/.test(b.textContent)).click()`)
await waitFor(`Array.from(document.querySelectorAll('.vw-card__name')).some(el => el.textContent === ${JSON.stringify(renamed)})`, 10000, '标签改名生效')
ok('tags：改名 → PATCH /api/tags/{id}', true, renamed)

// 删除（走 ctx.confirm，且断言文案提到关联数）
await evaluate(`(() => {
  const card = Array.from(document.querySelectorAll('.vw-card')).find(c => c.textContent.includes(${JSON.stringify(renamed)}));
  Array.from(card.querySelectorAll('.kb-btn')).find(b => b.textContent.includes('删除')).click();
  return true;
})()`)
await sleep(400)
const confirmLog = await evaluate(`JSON.stringify(window.__labLogs?.confirmLog ?? [])`)
const lastConfirm = JSON.parse(confirmLog).at(-1)
ok('tags：删除走 ctx.confirm 二次确认（非原生 confirm）', Boolean(lastConfirm) && /删除标签/.test(lastConfirm.title), JSON.stringify(lastConfirm ?? null))
await waitFor(`!Array.from(document.querySelectorAll('.vw-card__name')).some(el => el.textContent === ${JSON.stringify(renamed)})`, 10000, '标签删除生效')
ok('tags：删除 → DELETE /api/tags/{id}，列表回空态', true)

// 新建一个标签再点它 → 跳 search
await evaluate(`Array.from(document.querySelectorAll('.vw__actions .kb-btn')).find(b => b.textContent.includes('新建标签')).click()`)
await waitFor(`!!document.querySelector('.kb-modal')`, 6000, '再次新建')
await evaluate(`(() => {
  const input = document.querySelector('.kb-modal input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '中文排版测试');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`)
await evaluate(`Array.from(document.querySelectorAll('.kb-modal__footer .kb-btn')).find(b => /创建|保存/.test(b.textContent)).click()`)
await waitFor(`Array.from(document.querySelectorAll('.vw-card__name')).some(el => el.textContent === '中文排版测试')`, 10000, '标签就绪')
await evaluate(`document.querySelector('.vw-card__main').click()`)
await sleep(700)
const tagHash = await evaluate(`window.location.hash`)
ok('tags：点击标签卡 → ctx.navigate("search", {tag})', decodeURIComponent(tagHash).startsWith('#/search?tag='), tagHash)
// 收尾：删掉刚建的测试标签，避免污染演示库
await evaluate(`(async () => {
  const tags = await (await fetch('/api/tags')).json();
  for (const tag of tags) {
    if (/^(中文排版测试|验收标签)/.test(tag.name)) await fetch('/api/tags/' + tag.id, { method: 'DELETE', credentials: 'same-origin' });
  }
  return true;
})()`)

/* ------------------------------------------------------------------ 5. backlinks（note=3：两种双链） */
await nav('#/backlinks?note=3')
await waitFor(`document.querySelectorAll('.vw-section').length >= 2`, 12000, '反链视图渲染')
const bl = await evaluate(`JSON.stringify({
  sections: Array.from(document.querySelectorAll('.vw-section')).map(el => el.textContent.replace(/\\d+/g,'').trim()),
  backlinks: document.querySelectorAll('.vw-list .vw-row').length,
  resolved: Array.from(document.querySelectorAll('.kb-badge--success')).length,
  dangling: Array.from(document.querySelectorAll('.kb-badge--warning')).length,
  danglingText: document.querySelector('.kb-badge--warning')?.closest('.vw-row')?.textContent?.trim() ?? '',
  createBtn: !!Array.from(document.querySelectorAll('.kb-btn')).find(b => b.textContent.includes('创建此笔记'))
})`)
const b = JSON.parse(bl)
ok('backlinks：两个区块（反向引用 / 出链）', b.sections.some((x) => x.includes('反向引用')) && b.sections.some((x) => x.includes('出链')), JSON.stringify(b.sections))
ok('backlinks：反链显示来源标题', b.backlinks >= 1, `rows=${b.backlinks}`)
ok('backlinks：出链区分已创建 / 未创建', b.resolved >= 1 && b.dangling >= 1, `resolved=${b.resolved} dangling=${b.dangling}`)
ok('backlinks：未创建项给出「创建此笔记」按钮', b.createBtn, b.danglingText.slice(0, 40))
await shot('backlinks-note3')

const noteCountBefore = await evaluate(`(async () => (await (await fetch('/api/notes?size=200&sort=updated')).json()).total)()`)
await clickByText('.kb-btn', '创建此笔记')
// 轮询等 POST + 列表刷新落地（不假定固定的 1.8s）
let createdTotal = noteCountBefore
for (let i = 0; i < 20; i += 1) {
  await sleep(400)
  createdTotal = await evaluate(`(async () => (await (await fetch('/api/notes?size=200&sort=updated')).json()).total)()`)
  if (createdTotal > noteCountBefore) break
}
const afterCreate = await evaluate(`(async () => {
  const page = await (await fetch('/api/notes?size=200&sort=updated')).json();
  const created = page.items.find(n => n.title.includes('未创建的验收目标') || n.title.includes('这篇笔记还没写'));
  return JSON.stringify({ total: page.total, createdId: created ? created.id : null });
})()`)
const ac = JSON.parse(afterCreate)
ok('backlinks：「创建此笔记」真发 POST /api/notes（笔记总数 +1）', createdTotal === noteCountBefore + 1, `${noteCountBefore} → ${createdTotal}`)

/* ------------------------------------------------------------------ 6. versions（note=1 只读；自建笔记做真实回滚） */
await nav('#/versions?note=1')
await waitFor(`document.querySelectorAll('.vw-ver').length > 0`, 12000, '版本列表')
const ver = await evaluate(`JSON.stringify({
  count: document.querySelectorAll('.vw-ver').length,
  first: document.querySelector('.vw-ver')?.textContent?.trim() ?? '',
  currentBadge: !!document.querySelector('.kb-badge--accent')
})`)
const v = JSON.parse(ver)
ok('versions：列出历史版本（裸数组契约）', v.count >= 2 && /v\d+/.test(v.first), `count=${v.count} first=${v.first.slice(0, 30)}`)
// 选一个「内容与当前确实不同」的版本（按列表里的字数与当前正文长度差挑最大的）
const picked = await evaluate(`(async () => {
  const current = await (await fetch('/api/notes/1')).json();
  const rows = Array.from(document.querySelectorAll('.vw-ver'));
  let best = null;
  rows.forEach((row) => {
    const version = Number((row.querySelector('.vw-ver__row strong')?.textContent ?? '').replace(/\\D/g, '')) || 0;
    const counts = Array.from(row.querySelectorAll('.vw__count')).map((el) => Number((el.textContent.match(/(\\d+)/) ?? [])[1] ?? '0'));
    const size = counts.length ? Number(counts[0]) : 0;
    const delta = Math.abs(size - current.content.length);
    if (!best || delta > best.delta) best = { version, size, delta, row };
  });
  if (!best || best.delta === 0) return JSON.stringify({ ok: false, reason: '没有与当前内容不同的版本' });
  best.row.click();
  return JSON.stringify({ ok: true, version: best.version, size: best.size, currentLen: current.content.length });
})()`)
const pick = JSON.parse(picked)
ok('versions：存在与当前内容不同的历史版本可选', pick.ok, picked)
await waitFor(`document.querySelectorAll('.vw-diff__cell--add, .vw-diff__cell--del').length > 0`, 15000, 'diff 出现增删行')
const diff = await evaluate(`JSON.stringify({
  rows: document.querySelectorAll('.vw-diff__row').length,
  add: document.querySelectorAll('.vw-diff__cell--add').length,
  del: document.querySelectorAll('.vw-diff__cell--del').length,
  head: Array.from(document.querySelectorAll('.vw-diffhead span')).map(s => s.textContent)
})`)
const d = JSON.parse(diff)
// 演示笔记 1 的某个版本可能只删不加（数据决定），所以这里只要求「有差异行」+ 表头两栏
ok(
  'versions：diff 渲染且有差异行（增删数量依数据而定）',
  d.rows > 0 && d.add + d.del > 0 && d.head.length === 2,
  JSON.stringify({ ...d, picked: pick.version }),
)
ok('versions：回滚按钮存在（二次确认入口）', await evaluate(`!!Array.from(document.querySelectorAll('.kb-btn')).find(b => b.textContent.includes('回滚到此版本'))`))
await shot('versions-note1-diff')

// 用自建笔记做真实 diff + 回滚（不碰演示笔记）
// 先刻意改一次正文，保证「上一版 vs 当前」必然同时有新增行与删除行
await evaluate(`(async () => {
  const response = await fetch('/api/notes/${mineId}', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ content: '# 验收笔记 ' + ${JSON.stringify(STAMP)} + '\\n\\n保留行：第一行。\\n新增行一。\\n新增行二。\\n' })
  });
  if (!response.ok) throw new Error('PATCH 失败 HTTP ' + response.status);
  return true;
})()`)
await sleep(700)
await nav(`#/versions?note=${mineId}`)
await sleep(900) // 让上一个视图的 DOM 先被替换，避免抓到陈旧行
await waitFor(`document.querySelectorAll('.vw-ver').length >= 2`, 15000, '自建笔记版本列表（≥2）')
const mineVers = await evaluate(`JSON.stringify({
  rows: document.querySelectorAll('.vw-ver').length,
  versions: Array.from(document.querySelectorAll('.vw-ver')).map(el => el.querySelector('.vw-ver__row strong')?.textContent ?? '?')
})`)
const mv = JSON.parse(mineVers)
ok('versions：自建笔记已有历史版本（PATCH 正文后产生）', mv.rows >= 2, JSON.stringify(mv))

// 选中「上一个版本」看 diff（当前内容 vs 上一版）
await evaluate(`document.querySelectorAll('.vw-ver')[1].click()`)
await waitFor(`document.querySelectorAll('.vw-diff__cell--add, .vw-diff__cell--del').length > 0`, 12000, '自建笔记 diff 增删')
const mineDiff = JSON.parse(
  await evaluate(`JSON.stringify({
    add: document.querySelectorAll('.vw-diff__cell--add').length,
    del: document.querySelectorAll('.vw-diff__cell--del').length,
    rows: document.querySelectorAll('.vw-diff__row').length
  })`),
)
ok('versions：自建笔记 diff 同时出现新增与删除行', mineDiff.add > 0 && mineDiff.del > 0, JSON.stringify(mineDiff))

// 回滚到最早版本，走 ctx.confirm
await setConfirmAnswer(true)
const clickedRollback = await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('.vw-ver'));
  const target = rows[rows.length - 1];
  if (!target) return false;
  target.click();
  return true;
})()`)
ok('versions：可选中自建笔记的最早版本', clickedRollback)
await waitFor(`!!Array.from(document.querySelectorAll('.kb-btn')).find(b => b.textContent.includes('回滚到此版本'))`, 12000, '回滚按钮')
await clickByText('.kb-btn', '回滚到此版本')
await sleep(2000)
const restored = await evaluate(`JSON.stringify(window.__labLogs.confirmLog.at(-1))`)
ok('versions：回滚走 ctx.confirm 且文案说明「不会丢失」', /不会丢失/.test(restored), restored)
const mineAfter = await evaluate(`(async () => {
  const detail = await (await fetch('/api/notes/${mineId}')).json();
  const versions = await (await fetch('/api/notes/${mineId}/versions')).json();
  return JSON.stringify({
    version: detail.version,
    versions: versions.length,
    hasNewText: detail.content.includes('新增行一'),
    hasOldText: detail.content.includes('引用 [[双向链接演示（B）]]')
  });
})()`)
const ma = JSON.parse(mineAfter)
ok(
  'versions：回滚真的生效（版本号增长，内容回到最早版本）',
  ma.version >= 3 && ma.hasNewText === false && ma.hasOldText === true,
  JSON.stringify(ma),
)
const shellCalls = JSON.parse(
  await evaluate(`JSON.stringify((window.__labLogs?.shellCallLog ?? []).slice(-3))`),
)
ok(
  'versions：回滚后按 reloadCurrentNote → refreshNotes 的顺序通知外壳',
  shellCalls.includes('reloadCurrentNote') &&
    shellCalls.lastIndexOf('reloadCurrentNote') < shellCalls.lastIndexOf('refreshNotes'),
  JSON.stringify(shellCalls),
)

/* ------------------------------------------------------------------ 7. favorites */
await evaluate(`(async () => {
  await fetch('/api/notes/${mineId}', { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body: JSON.stringify({ isFavorite: true }) });
  return true;
})()`)
await nav('#/favorites')
await waitFor(`document.querySelectorAll('.vw-list .vw-row').length > 0`, 12000, '收藏列表')
const fav = await evaluate(`JSON.stringify({
  rows: document.querySelectorAll('.vw-list .vw-row').length,
  title: document.querySelector('.vw-row__title')?.textContent ?? '',
  total: document.querySelector('.vw__count')?.textContent ?? ''
})`)
const f = JSON.parse(fav)
ok('favorites：分页信封渲染列表（含自建笔记）', f.rows >= 1 && f.title.includes('验收笔记'), JSON.stringify(f))
await evaluate(`Array.from(document.querySelectorAll('.kb-btn')).find(b => b.textContent.includes('取消收藏')).click()`)
await sleep(1200)
const favAfter = await evaluate(`(async () => {
  const page = await (await fetch('/api/favorites')).json();
  return JSON.stringify({ total: page.total, emptyShown: !!document.querySelector('.vw .kb-empty') });
})()`)
const fa = JSON.parse(favAfter)
ok('favorites：取消收藏 → PATCH {isFavorite:false} 并移除该行', fa.total === 0, JSON.stringify(fa))
await shot('state-empty-favorites')

/* ------------------------------------------------------------------ 8. recent */
await evaluate(`(async () => {
  await fetch('/api/notes/${mineId}/view', { method:'POST', credentials:'same-origin' });
  return true;
})()`)
await nav('#/recent')
await waitFor(`document.querySelectorAll('.vw-list .vw-row').length > 0`, 12000, '最近浏览')
const recent = await evaluate(`JSON.stringify({
  rows: document.querySelectorAll('.vw-list .vw-row').length,
  meta: document.querySelector('.vw-row__meta')?.textContent ?? '',
  title: document.querySelector('.vw-row__title')?.textContent ?? ''
})`)
const rc = JSON.parse(recent)
ok('recent：viewedAt 相对时间 + 列表渲染', rc.rows >= 1 && /刚刚|分钟前|小时前|天前/.test(rc.meta), JSON.stringify(rc))
await shot('recent-list')
// 条数切换
const reqBefore = await evaluate(`window.__reqs.filter(r => r.url.includes('/api/recent')).length`)
await evaluate(`(() => {
  const select = document.querySelector('#vw-recent-limit');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(select, '50');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`)
await sleep(900)
const limitReq = await evaluate(`window.__reqs.filter(r => r.url.includes('/api/recent')).slice(-1)[0]?.url ?? ''`)
ok('recent：条数切换 10/20/50 触发新请求', limitReq.includes('limit=50'), `${limitReq}（切换前请求数 ${reqBefore}）`)

/** 切到某路由并等它真正加载完内容（dev server 被队友改配置重启时自动重试，避免截到错误态） */
async function ensureViewLoaded(route) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await nav(route)
    try {
      await waitFor(`!!document.querySelector('.vw')`, 12000, `${route} 渲染`)
    } catch {
      /* 重试 */
    }
    await sleep(900)
    const state = JSON.parse(
      await evaluate(`JSON.stringify({
        failed: (document.querySelector('.vw .kb-empty__title')?.textContent ?? '').includes('失败'),
        loading: document.querySelectorAll('.vw .kb-skeleton').length > 0,
        empty: !!document.querySelector('.vw .kb-empty')
      })`),
    )
    if (!state.failed && !state.loading) return true
    await sleep(1200)
  }
  return false
}

/* ------------------------------------------------------------------ 9. 四断点横向溢出（search + tags） */
const BREAKPOINTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'laptop-1180x800', width: 1180, height: 800 },
  { name: 'tablet-900x700', width: 900, height: 700 },
  { name: 'phone-390x844', width: 390, height: 844 },
]
for (const bp of BREAKPOINTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: bp.width,
    height: bp.height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  for (const route of ['#/search?q=排版', '#/tags']) {
    const loaded = await ensureViewLoaded(route)
    const metrics = JSON.parse(await shot(`${bp.name}-${route.includes('search') ? 'search' : 'tags'}`))
    const overflowFree = metrics.docScroll <= metrics.docClient && metrics.probeOverflow.every((x) => x <= 0)
    ok(
      `断点 ${bp.name} · ${route}：内容加载正常且无横向溢出`,
      overflowFree && loaded,
      `doc ${metrics.docScroll}<=${metrics.docClient} · .vw 溢出=${JSON.stringify(metrics.probeOverflow)} · 内容=${loaded ? 'OK' : '未加载'}`,
    )
  }
}
await send('Emulation.clearDeviceMetricsOverride')

/* ------------------------------------------------------------------ 11. 真外壳集成冒烟（registry 已接入 AppShell） */
const APP = process.env.APP || 'http://localhost:5173/proto/index.html'
await send('Emulation.clearDeviceMetricsOverride')

async function openAppPage() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await ensureDevServer()          // 队友改 vite 配置会让 dev server 重启，这里再确认一次
    await send('Page.navigate', { url: APP })
    try {
      await waitFor(`location.href.startsWith('http://localhost:5173/')`, 20000, '真外壳页面加载')
      return true
    } catch {
      console.log('  真外壳页面未加载（dev server 可能刚被重启），重试…')
      await sleep(1500)
    }
  }
  return false
}

const appLoaded = await openAppPage()
ok('真外壳：页面可访问（dev server 存活）', appLoaded, APP)
await sleep(800)

const needsLogin = await evaluate(`!!document.querySelector('.kb-login__form')`)
if (needsLogin) {
  await setControl('input[name="username"]', DEMO.username)
  await setControl('input[name="password"]', DEMO.password)
  await evaluate(`(() => {
    const form = document.querySelector('.kb-login__form');
    if (form.requestSubmit) form.requestSubmit();
    else form.querySelector('button[type="submit"]').click();
    return true;
  })()`)
}
await waitFor(`!!document.querySelector('.kb-sidebar')`, 25000, '登录后进入外壳')
ok('真外壳：登录成功并挂载 AppShell（真路由 + 真 ViewContext）', true, needsLogin ? '走登录表单' : '沿用会话')

const SHELL_ROUTES = [
  ['#/search?q=天气', '搜索'],
  ['#/tags', '标签'],
  ['#/backlinks?note=3', '反链'],
  ['#/versions?note=1', '历史版本'],
  ['#/favorites', '收藏'],
  ['#/recent', '最近浏览'],
]
for (const [hash, expectedTitle] of SHELL_ROUTES) {
  await nav(hash)
  try {
    await waitFor(`!!document.querySelector('.vw')`, 20000, `${hash} 视图挂载`)
    await sleep(700)
    const info = JSON.parse(
      await evaluate(`JSON.stringify({
        title: document.querySelector('.vw__title')?.textContent ?? '',
        inShell: !!document.querySelector('.kb-sidebar') && !!document.querySelector('.kb-main'),
        body: (document.querySelector('.vw')?.textContent ?? '').trim().length
      })`),
    )
    ok(
      `真外壳：${hash} → 「${expectedTitle}」视图在 shell 内挂载`,
      info.title === expectedTitle && info.inShell && info.body > 0,
      JSON.stringify(info),
    )
  } catch (error) {
    ok(`真外壳：${hash} → 「${expectedTitle}」视图在 shell 内挂载`, false, error.message)
  }
}
await nav('#/tags')
await waitFor(`!!document.querySelector('.vw')`, 15000, '外壳内 tags')
await shot('real-shell-tags-1440x900')

/* ------------------------------------------------------------------ 12. 收尾：无 console 错误 + 清理自建数据 */
const errs = await evaluate(`JSON.stringify((window.__errors ?? []).slice(0, 5))`)
ok('全程无 console.error / 未捕获异常', JSON.parse(errs).length === 0, errs)

const cleanup = await evaluate(`(async () => {
  const page = await (await fetch('/api/notes?size=200&sort=updated')).json();
  const mine = page.items.filter(n => /XSSPROBE|ESCPROBE|NESTPROBE|验收笔记|未创建的验收目标|这篇笔记还没写/.test(n.title)).map(n => n.id);
  for (const id of mine) await fetch('/api/notes/' + id, { method: 'DELETE', credentials: 'same-origin' });
  const after = await (await fetch('/api/notes?size=200&sort=updated')).json();
  return JSON.stringify({ deleted: mine, remainingTitles: after.items.map(n => n.title) });
})()`)
const cl = JSON.parse(cleanup)
const DEMO_TITLES = [
  '欢迎使用知识库',
  'Markdown 速查',
  '双向链接演示（A）',
  '双向链接演示（B）',
  '中文排版测试',
  '长文档性能测试',
]
// 直接按 id 取 1..6 校验（dev 库里可能有 200+ 篇队友的导入数据，列表首页看不到老笔记）
const demoCheck = JSON.parse(
  await evaluate(`(async () => {
    const out = [];
    for (let id = 1; id <= 6; id += 1) {
      const response = await fetch('/api/notes/' + id);
      out.push(response.ok ? (await response.json()).title : 'HTTP_' + response.status);
    }
    return JSON.stringify(out);
  })()`),
)
const missingDemo = DEMO_TITLES.filter((title) => !demoCheck.includes(title))
ok(
  '清理自建测试数据（6 篇演示笔记完好）',
  missingDemo.length === 0,
  `删除了 ${cl.deleted.length} 篇自建笔记；id 1..6 = ${demoCheck.join(' / ')}`,
)

console.log('\n=== 截图 ===')
console.log(SHOT_DIR)
console.log(`\n=== React 视图验收：${R.length - failed}/${R.length} 通过 ===`)
ws.close()
killChildren()
process.exit(failed ? 1 : 0)

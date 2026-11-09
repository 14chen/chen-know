/**
 * 极简 Chrome DevTools Protocol 客户端（零依赖：Node 22 自带全局 WebSocket）。
 * 只覆盖验收需要的：导航、求值、键盘、鼠标、IME、截图。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

function findBrowser() {
  for (const p of CANDIDATES) if (existsSync(p)) return p
  throw new Error('未找到 Edge/Chrome 可执行文件')
}

async function waitFor(fn, { timeout = 20000, interval = 150 } = {}) {
  const t0 = Date.now()
  let lastErr = null
  while (Date.now() - t0 < timeout) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      lastErr = e
    }
    await sleep(interval)
  }
  throw new Error(`等待超时（${timeout}ms）${lastErr ? ': ' + lastErr.message : ''}`)
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

class Cdp {
  constructor(url) {
    this.url = url
    this.id = 0
    this.pending = new Map()
    this.listeners = []
  }
  async connect() {
    this.ws = new WebSocket(this.url)
    this.ws.addEventListener('message', (ev) => this.onMessage(ev.data))
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
  }
  onMessage(data) {
    const msg = JSON.parse(typeof data === 'string' ? data : data.toString())
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`))
      else resolve(msg.result)
      return
    }
    if (msg.method) for (const l of this.listeners) l(msg)
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.ws.send(JSON.stringify(payload))
      } catch (e) {
        this.pending.delete(id)
        reject(e)
      }
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, 30000)
    })
  }
  on(fn) {
    this.listeners.push(fn)
  }
  close() {
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
  }
}

export class Page {
  constructor(cdp, sessionId, browser) {
    this.cdp = cdp
    this.sid = sessionId
    this.browser = browser
    this.consoleErrors = []
    cdp.on((msg) => {
      if (msg.sessionId !== this.sid) return
      if (msg.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception')
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
      }
    })
  }
  send(method, params = {}) {
    return this.cdp.send(method, params, this.sid)
  }
  async eval(expression, { awaitPromise = true } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    })
    if (res.exceptionDetails) {
      throw new Error(
        `页面求值异常: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`,
      )
    }
    return res.result?.value
  }
  async waitFor(expression, opts = {}) {
    return waitFor(async () => {
      const v = await this.eval(expression)
      return v === true || (v !== false && v !== null && v !== undefined && v !== 0 && v !== '') ? v : null
    }, opts)
  }
  async insertText(text) {
    await this.send('Input.insertText', { text })
  }
  async key(key, { code, keyCode, modifiers = 0, type = 'rawKeyDown' } = {}) {
    const params = {
      type,
      key,
      code,
      windowsVirtualKeyCode: keyCode ?? key.toUpperCase().charCodeAt(0),
      nativeVirtualKeyCode: keyCode ?? key.toUpperCase().charCodeAt(0),
      modifiers,
    }
    await this.send('Input.dispatchKeyEvent', params)
    await this.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
  }
  async combo(letter, modifiers = 2) {
    const upper = letter.toUpperCase()
    const code = `Key${upper}`
    return this.key(letter, { code, keyCode: upper.charCodeAt(0), modifiers })
  }
  async imeSetComposition(text, start = text.length, end = text.length) {
    await this.send('Input.imeSetComposition', {
      text,
      selectionStart: start,
      selectionEnd: end,
    })
  }
  async click(x, y) {
    const base = { x, y, button: 'left', clickCount: 1, buttons: 1 }
    await this.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' })
    await this.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 })
  }
  async rectOf(selector) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }
    })()`)
  }
  async screenshot(path) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(path, Buffer.from(res.data, 'base64'))
    return path
  }
  async setViewport(width, height, { mobile = false } = {}) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    })
  }
  /** 触摸设备模拟：开启后 (pointer: coarse) 才会匹配 */
  async setTouch(enabled) {
    await this.send(
      'Emulation.setTouchEmulationEnabled',
      enabled ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
    )
  }
  /** 真实鼠标点击 rectOf() 返回的矩形（它的 x/y 已经是中心点） */
  async clickRect(rect) {
    await this.click(rect.x, rect.y)
  }
}

export class Browser {
  static async launch({ port = 9400 + Math.floor(Math.random() * 500), width = 1280, height = 900 } = {}) {
    const exe = findBrowser()
    const userDataDir = await mkdtemp(join(tmpdir(), 'kb-cdp-'))
    const proc = spawn(
      exe,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--hide-scrollbars',
        `--window-size=${width},${height}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    )
    const version = await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      return r.ok ? r.json() : null
    })
    const cdp = new Cdp(version.webSocketDebuggerUrl)
    await cdp.connect()
    return new Browser(cdp, proc, userDataDir)
  }
  constructor(cdp, proc, userDataDir) {
    this.cdp = cdp
    this.proc = proc
    this.userDataDir = userDataDir
  }
  async newPage(url) {
    const { targetId } = await this.cdp.send('Target.createTarget', { url })
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const page = new Page(this.cdp, sessionId, this)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    return page
  }
  async close() {
    this.cdp.close()
    this.proc.kill()
    await sleep(300)
    try {
      await rm(this.userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

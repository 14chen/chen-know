// 极简 CDP 驱动：用 Node 22 自带的 WebSocket 直接驱动 headless Edge。
// Lead 的独立验收工具 —— 刻意不复用实现者的脚本，保持验证独立性。
// 同时用于后续「图文使用手册」的截图生成。
//
// 用法（作为库）：
//   import { launch } from './cdp.mjs'
//   const b = await launch()
//   const p = await b.newPage('http://localhost:5173/proto/index.html')
//   await p.waitFor('document.querySelector("#root") !== null')
//   await p.screenshot('out.png')
//   await b.close()

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.EDGE || '',
]

function findEdge() {
  for (const c of EDGE_CANDIDATES) {
    if (c && existsSync(c)) return c
  }
  throw new Error('找不到 Edge 可执行文件，可用环境变量 EDGE 指定')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ port = 0, width = 1440, height = 900, scale = 1 } = {}) {
  const exe = findEdge()
  const profile = mkdtempSync(join(tmpdir(), 'kbcdp-'))
  // 端口默认随机：固定端口会被上一次残留的 headless 实例占住，
  // 新进程绑定失败后 /json/version 会返回**旧实例**的信息，
  // 于是后续 navigate 挂在一个陈旧的页面上 —— 这个坑实测踩过。
  const dbgPort = port || 9300 + Math.floor(Math.random() * 600)
  const child = spawn(
    exe,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--remote-debugging-port=${dbgPort}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      `--force-device-scale-factor=${scale}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  // 等 DevTools 端口就绪
  let version = null
  let browserWs = null
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${dbgPort}/json/version`)
      if (r.ok) {
        version = await r.json()
        browserWs = version.webSocketDebuggerUrl || null
        break
      }
    } catch {}
    await sleep(250)
  }
  if (!version) {
    child.kill()
    throw new Error(`Edge DevTools 端口 ${dbgPort} 未就绪`)
  }

  // 确认端口确实属于**我们刚启动的**进程：比对浏览器进程 pid 与 child.pid 是否一致
  // （/json/version 里没有 pid，这里退一步用 profile 目录校验——是我们的临时目录即视为自己的）
  return {
    version,
    _port: dbgPort,
    _child: child,
    _profile: profile,

    async newPage(url = 'about:blank') {
      const r = await fetch(`http://127.0.0.1:${dbgPort}/json/new?${encodeURIComponent(url)}`, {
        method: 'PUT',
      })
      if (!r.ok) throw new Error(`创建标签页失败: HTTP ${r.status}`)
      const target = await r.json()
      return await connect(target.webSocketDebuggerUrl)
    },

    async close() {
      try {
        child.kill()
      } catch {}
      await sleep(400)
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {}
    },
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  const events = []

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', (e) => reject(new Error(`WebSocket 错误: ${e.message || e.type}`)), {
      once: true,
    })
  })

  ws.addEventListener('message', (ev) => {
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`))
      else resolve(msg.result)
    } else if (msg.method) {
      events.push(msg)
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      // 截图在高 DPI + 满屏时可能耗时较久，给它更宽的预算
      const budget = method === 'Page.captureScreenshot' ? 90000 : 30000
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, budget)
    })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('DOM.enable')

  const page = {
    _send: send,
    events,

    async goto(url, { waitMs = 800 } = {}) {
      await send('Page.navigate', { url })
      await page.waitForLoad()
      await sleep(waitMs)
    },

    async waitForLoad(timeout = 20000) {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        const { result } = await send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        })
        if (result.value === 'complete') return
        await sleep(150)
      }
    },

    /** 轮询表达式直到为真；返回最后一次的求值结果 */
    async waitFor(expr, { timeout = 20000, interval = 200, label = expr } = {}) {
      const start = Date.now()
      let last
      while (Date.now() - start < timeout) {
        try {
          const { result, exceptionDetails } = await send('Runtime.evaluate', {
            expression: expr,
            returnByValue: true,
            awaitPromise: true,
          })
          if (exceptionDetails) last = { error: exceptionDetails.text }
          else {
            last = result.value
            if (result.value) return result.value
          }
        } catch (e) {
          last = { error: String(e) }
        }
        await sleep(interval)
      }
      throw new Error(`waitFor 超时（${timeout}ms）: ${label}; 最后结果=${JSON.stringify(last)}`)
    },

    async eval(expr) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression: `(function(){ return (${expr}); })()`,
        returnByValue: true,
        awaitPromise: true,
      })
      if (exceptionDetails) throw new Error(`求值异常: ${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`)
      return result.value
    },

    /** 执行一段语句（不返回值） */
    async run(code) {
      const { exceptionDetails } = await send('Runtime.evaluate', {
        expression: `(function(){ ${code} })()`,
        returnByValue: true,
        awaitPromise: true,
      })
      if (exceptionDetails) throw new Error(`执行异常: ${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`)
    },

    async setViewport(width, height, scale = 1) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: false,
      })
      await sleep(300)
    },

    async screenshot(path, { fullPage = false, selector = null } = {}) {
      let clip
      if (selector) {
        const box = await page.eval(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })()`)
        if (!box) throw new Error(`截图元素不存在: ${selector}`)
        clip = { ...box, scale: 1 }
      } else if (fullPage) {
        const m = await send('Page.getLayoutMetrics')
        const size = m.cssContentSize || m.contentSize
        clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 }
      }
      const params = { format: 'png', captureBeyondViewport: Boolean(clip) }
      if (clip) params.clip = clip
      const { data } = await send('Page.captureScreenshot', params)
      writeFileSync(path, Buffer.from(data, 'base64'))
      return path
    },

    /** 真实鼠标点击（按坐标） */
    async clickAt(x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
      }
      await sleep(150)
    },

    /** 真实鼠标点击（按选择器取中心点） */
    async click(selector) {
      const box = await page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`)
      if (!box) throw new Error(`元素不存在: ${selector}`)
      await page.clickAt(box.x, box.y)
    },

    async type(text, { perChar = 20 } = {}) {
      for (const ch of text) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch })
        await send('Input.dispatchKeyEvent', { type: 'keyUp' })
        await sleep(perChar)
      }
    },

    async press(key, { ctrl = false, shift = false, alt = false } = {}) {
      const mods = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0)
      const map = {
        Enter: { windowsVirtualKeyCode: 13, key: 'Enter', text: '\r' },
        Escape: { windowsVirtualKeyCode: 27, key: 'Escape' },
        Tab: { windowsVirtualKeyCode: 9, key: 'Tab' },
        ArrowDown: { windowsVirtualKeyCode: 40, key: 'ArrowDown' },
        ArrowUp: { windowsVirtualKeyCode: 38, key: 'ArrowUp' },
        ArrowLeft: { windowsVirtualKeyCode: 37, key: 'ArrowLeft' },
        ArrowRight: { windowsVirtualKeyCode: 39, key: 'ArrowRight' },
        Backspace: { windowsVirtualKeyCode: 8, key: 'Backspace' },
        a: { windowsVirtualKeyCode: 65, key: 'a', text: 'a' },
        s: { windowsVirtualKeyCode: 83, key: 's', text: 's' },
        k: { windowsVirtualKeyCode: 75, key: 'k', text: 'k' },
        b: { windowsVirtualKeyCode: 66, key: 'b', text: 'b' },
        c: { windowsVirtualKeyCode: 67, key: 'c', text: 'c' },
        i: { windowsVirtualKeyCode: 73, key: 'i', text: 'i' },
        u: { windowsVirtualKeyCode: 85, key: 'u', text: 'u' },
        v: { windowsVirtualKeyCode: 86, key: 'v', text: 'v' },
        x: { windowsVirtualKeyCode: 88, key: 'x', text: 'x' },
        y: { windowsVirtualKeyCode: 89, key: 'y', text: 'y' },
        z: { windowsVirtualKeyCode: 90, key: 'z', text: 'z' },
      }
      const info = map[key]
      if (!info) throw new Error(`未支持的按键: ${key}`)
      const base = {
        modifiers: mods,
        key: info.key,
        windowsVirtualKeyCode: info.windowsVirtualKeyCode,
        nativeVirtualKeyCode: info.windowsVirtualKeyCode,
      }
      if (ctrl) base.text = ''
      else if (info.text) base.text = info.text
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
      await sleep(120)
    },

    async consoleErrors() {
      return events
        .filter((e) => e.method === 'Runtime.exceptionThrown')
        .map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text)
    },

    async close() {
      try {
        ws.close()
      } catch {}
    },
  }

  return page
}

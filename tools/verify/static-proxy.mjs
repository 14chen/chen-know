/** 静态服务 + /api 反代：把 pnpm run build 的产物（backend/.../static）当站点跑，API 转发到真后端。
 *  用法：node static-proxy.mjs [--port 8091] [--root ../backend/src/main/resources/static] [--api http://127.0.0.1:8090]
 */
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const PORT = Number(arg('--port', '8091'))
const ROOT = arg('--root', new URL('../../backend/src/main/resources/static', import.meta.url).pathname.replace(/^\//, ''))
const API = arg('--api', 'http://127.0.0.1:8090')
/** 可选：让 POST /api/weekly/run 直接返回固定响应（真实抓取不可达时验证「成功态」UI 用） */
const WEEKLY_CANNED = arg('--weekly-canned', '')
/** 可选：让 POST /api/weekly/run 返回 500 + 具体原因（验证「失败态显示后端原因 + 重试」） */
const WEEKLY_FAIL = arg('--weekly-fail', '')
/** 可选：给 GET /api/weekly/runs 每条记录注入 notesSkipped（验证「预留读取」） */
const WEEKLY_RUNS_SKIPPED = arg('--weekly-runs-skipped', '')
/** 可选：把 GET /api/weekly/runs 里的 notesSkipped 删掉（验证「没有该字段时显示 —」） */
const WEEKLY_RUNS_NO_SKIPPED = arg('--weekly-runs-no-skipped', '') === '1'
/** 可选：让 PATCH /api/notes/{id} 直接返回 403（验证权限提示） */
const PATCH_403 = arg('--patch-403', '') === '1'
/** 可选：让 PATCH /api/notes/{id} 直接返回 500 + 原因（验证保存失败要带原因） */
const PATCH_FAIL = arg('--patch-fail', '')

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8' }

async function readAsset(path) {
  const safe = normalize(path).replace(/^([.][.][/\\])+/, '')
  const file = join(ROOT, safe)
  const s = await stat(file)
  if (!s.isFile()) throw new Error('not a file')
  return await readFile(file)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (PATCH_403 && req.method === 'PATCH' && url.pathname.indexOf('/api/notes/') === 0) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { code: 'FORBIDDEN', message: '该笔记属于其他空间' } }))
    return
  }
  if (PATCH_FAIL && req.method === 'PATCH' && url.pathname.indexOf('/api/notes/') === 0) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { code: 'INTERNAL', message: PATCH_FAIL } }))
    return
  }
  if (WEEKLY_FAIL && url.pathname === '/api/weekly/run' && req.method === 'POST') {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { code: 'INTERNAL', message: WEEKLY_FAIL } }))
    return
  }
  if (WEEKLY_CANNED && url.pathname === '/api/weekly/run' && req.method === 'POST') {
    const body = await readFile(WEEKLY_CANNED, 'utf8')
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(body)
    return
  }
  if (url.pathname.startsWith('/api/')) {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const headers = { ...req.headers }
    delete headers.host
    // 浏览器带 Origin/Referer，后端会当成跨源请求拒掉（「跨源请求被拒绝」）——反代里抹掉，按同源处理
    delete headers.origin
    delete headers.referer
    try {
      const upstream = await fetch(API + req.url, { method: req.method, headers, body })
      let buf = Buffer.from(await upstream.arrayBuffer())
      if ((WEEKLY_RUNS_SKIPPED || WEEKLY_RUNS_NO_SKIPPED) && url.pathname === '/api/weekly/runs' && upstream.ok) {
        try {
          const parsed = JSON.parse(buf.toString('utf8'))
          if (Array.isArray(parsed.items)) {
            parsed.items = parsed.items.map((item) => {
              const clone = { ...item }
              if (WEEKLY_RUNS_NO_SKIPPED) delete clone.notesSkipped
              else clone.notesSkipped = Number(WEEKLY_RUNS_SKIPPED)
              return clone
            })
          }
          buf = Buffer.from(JSON.stringify(parsed), 'utf8')
        } catch {
          /* 非 JSON 原样返回 */
        }
      }
      const out = {}
      upstream.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) out[k] = v })
      res.writeHead(upstream.status, out)
      res.end(buf)
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'BAD_GATEWAY', message: String(err) } }))
    }
    return
  }
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'
  try {
    let data = await readAsset(pathname)
    if (pathname === '/index.html') {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' })
      res.end(data)
      return
    }
    res.writeHead(200, { 'content-type': MIME[extname(pathname)] || 'application/octet-stream', 'cache-control': 'no-cache' })
    res.end(data)
  } catch {
    // SPA 兜底：无扩展名的路由一律回 index.html
    if (!extname(pathname)) {
      try {
        const data = await readAsset('/index.html')
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' })
        res.end(data)
        return
      } catch {}
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404 ' + pathname)
  }
})

server.listen(PORT, '127.0.0.1', () => console.log('static+proxy on http://127.0.0.1:' + PORT + ' root=' + ROOT + ' api=' + API))
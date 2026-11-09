/**
 * 简报 API mock（契约 docs/BRIEFING.md §6）。只实现前端用到的四个端点 + 场景开关。
 * 用法：node mock.mjs --port 8899 [--delay 1200]
 * 场景：POST /__scenario {mode:'ok'|'empty'|'error'|'conflict', reportShape:'string'|'array'}
 */
import http from 'node:http'

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const PORT = Number(arg('--port', '8899'))
const DELAY = Number(arg('--delay', '0'))

const S = { mode: 'ok', reportShape: 'string', runs: [] }

const SOURCES = [
  { id: 1, name: 'OpenAI', url: 'https://openai.com/news/rss.xml', kind: 'rss' },
  { id: 2, name: 'Hacker News', url: 'https://hn.algolia.com/api/v1/search?query=AI', kind: 'json' },
  { id: 3, name: 'Anthropic', url: 'https://www.anthropic.com/news', kind: 'html' },
  { id: 4, name: '量子位', url: 'https://www.qbitai.com/feed', kind: 'rss' },
]

const REPORT = [
  { source: 'OpenAI', ok: true, count: 12, error: null },
  { source: 'Hacker News', ok: true, count: 18, error: null },
  { source: 'Anthropic', ok: true, count: 5, error: null },
  { source: '量子位', ok: false, count: 0, error: 'HTTP 403' },
]

function seedRuns() {
  const now = Date.now()
  S.runs = [
    { id: 2, startedAt: new Date(now - 3600_000).toISOString(), finishedAt: new Date(now - 3590_000).toISOString(), status: 'partial', totalItems: 35, newItems: 9, noteId: 3, sourceReport: REPORT },
    { id: 1, startedAt: new Date(now - 86400_000).toISOString(), finishedAt: new Date(now - 86390_000).toISOString(), status: 'success', totalItems: 41, newItems: 41, noteId: 2, sourceReport: REPORT },
  ]
}
seedRuns()

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname
  let body = ''
  for await (const chunk of req) body += chunk
  if (DELAY) await new Promise((r) => setTimeout(r, DELAY))

  if (p === '/__scenario') {
    const parsed = JSON.parse(body || '{}')
    Object.assign(S, parsed)
    if (S.mode === 'empty') S.runs = []
    if (S.mode === 'empty' || S.mode === 'ok' || S.mode === 'conflict') {
      if (parsed.reportShape || S.mode === 'empty') { /* keep */ }
      if (S.mode !== 'empty') seedRuns()
    }
    return json(res, 200, { ok: true, state: S })
  }

  if (p === '/api/briefing/sources') {
    if (S.mode === 'error') return json(res, 500, { error: { code: 'INTERNAL', message: '源配置读取失败' } })
    return json(res, 200, { items: SOURCES })
  }

  if (p === '/api/briefing/runs') {
    if (S.mode === 'error') return json(res, 500, { error: { code: 'INTERNAL', message: '运行历史读取失败' } })
    const limit = Number(url.searchParams.get('limit') || 10)
    const items = S.runs.slice(0, limit).map((run) => ({
      ...run,
      sourceReport: S.reportShape === 'array' ? run.sourceReport : JSON.stringify(run.sourceReport),
    }))
    return json(res, 200, { items })
  }

  if (p === '/api/briefing/run' && req.method === 'POST') {
    if (S.mode === 'error') return json(res, 500, { error: { code: 'INTERNAL', message: '抓取源失败' } })
    if (S.mode === 'conflict') return json(res, 409, { error: { code: 'CONFLICT', message: '已有简报任务在运行' } })
    const run = {
      id: 100 + S.runs.length + 1,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'success',
      totalItems: 42,
      newItems: 7,
      noteId: 3,
      sourceReport: S.reportShape === 'array' ? REPORT : JSON.stringify(REPORT),
    }
    S.runs.unshift(run)
    return json(res, 200, run)
  }

  json(res, 404, { error: { code: 'NOT_FOUND', message: p } })
})

server.listen(PORT, '127.0.0.1', () => console.log('briefing mock on http://127.0.0.1:' + PORT + ' delay=' + DELAY))

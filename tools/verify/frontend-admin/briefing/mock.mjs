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

// 与真实后端 BriefingSourceView.id / sourceReport[].source 的语义保持一致：都是 source id 字符串
const SOURCES = [
  { id: 'openai', name: 'OpenAI', url: 'https://openai.com/news/rss.xml', kind: 'rss', skipped: false, note: null },
  { id: 'hackernews', name: 'Hacker News', url: 'https://hn.algolia.com/api/v1/search?query=AI', kind: 'json', skipped: false, note: null },
  { id: 'anthropic', name: 'Anthropic', url: 'https://www.anthropic.com/news', kind: 'html', skipped: false, note: null },
  { id: 'qbitai', name: '量子位', url: 'https://www.qbitai.com/feed', kind: 'rss', skipped: false, note: null },
  { id: 'importai', name: 'Import AI', url: 'https://www.importai.net/feed', kind: 'rss', skipped: true, note: '已知不可达（Cloudflare 反爬，本次已跳过）' },
]

const REPORT = [
  { source: 'openai', ok: true, count: 12, error: null },
  { source: 'hackernews', ok: true, count: 18, error: null },
  { source: 'anthropic', ok: true, count: 5, error: null },
  { source: 'qbitai', ok: false, count: 0, error: 'HTTP 403' },
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

  // P1 条目明细 / 反馈（虚构但符合真实契约的数据）
  const FEED_ITEMS = [
    ['https://openai.com/index/agents', '编码代理如何加速研究', '国外·一手', 'OpenAI', 92, ['评测显示代理加速不均衡', '开源了基准'], '与你已有的《AI 简报》相关'],
    ['https://deepmind.google/blog/x', 'DeepMind 新模型', '国外·一手', 'Google DeepMind', 88, ['多模态能力提升'], ''],
    ['https://www.anthropic.com/news/y', 'Anthropic 发布新功能', '国外·一手', 'Anthropic', 81, ['更长的上下文'], ''],
    ['https://techmeme.com/a', 'Techmeme 快讯汇总', '国外·快讯', 'Techmeme', 76, ['今日要闻'], ''],
    ['https://hn.algolia.com/item/1', 'HN 热门讨论', '国外·快讯', 'Hacker News', 71, ['社区关注点'], ''],
    ['https://www.qbitai.com/a', '量子位报道', '国内', '量子位', 63, [], ''],
    ['https://arxiv.org/abs/1', 'arXiv 论文', '研究', 'arXiv cs.AI', 55, [], ''],
  ].map(([url, title, theme, source, qualityScore, keyPoints, related], i) => ({
    url, title, summary: title + '，正文摘要用于验证渲染。', source, theme, qualityScore,
    accepted: qualityScore >= 70, rank: i + 1, keyPoints,
    whyItMatters: qualityScore >= 70 ? '这与你关注的主题直接相关。' : null,
    relatedTitles: related ? [related] : [],
  }))
  if (p === '/api/briefing/items') {
    const theme = url.searchParams.get('theme')
    const q = (url.searchParams.get('q') || '').trim()
    const page = Math.max(1, Number(url.searchParams.get('page') || 1))
    let items = FEED_ITEMS
    if (theme) items = items.filter((i) => i.theme === theme)
    if (q) items = items.filter((i) => (i.title + i.summary).includes(q))
    return json(res, 200, { items: items.slice((page - 1) * 10, page * 10), page, size: 10, total: items.length })
  }
  const runMatch = p.match(/^\/api\/briefing\/runs\/(\d+)$/)
  if (runMatch) {
    const id = Number(runMatch[1])
    const run = S.runs.find((r) => r.id === id) || {
      id, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      status: 'success', totalItems: 42, newItems: 7, noteId: 3,
      sourceReport: S.reportShape === 'array' ? REPORT : JSON.stringify(REPORT),
    }
    return json(res, 200, { run, items: FEED_ITEMS })
  }
  if (p === '/api/briefing/items/feedback' && req.method === 'POST') {
    return json(res, 200, { ok: true })
  }

  // P2 异步 run：立即 202；进度接口直接给终态，让现有断言无需长轮询
  if (p === '/api/briefing/run' && req.method === 'POST' && url.searchParams.get('async') === 'true') {
    if (S.mode === 'conflict') {
      return json(res, 409, { error: { code: 'CONFLICT', message: '已有简报任务在运行' } })
    }
    const runId = 100 + S.runs.length + 1
    S.runs.unshift({
      id: runId, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      status: 'success', totalItems: 42, newItems: 7, noteId: 3,
      sourceReport: S.reportShape === 'array' ? REPORT : JSON.stringify(REPORT),
    })
    return json(res, 202, { runId, status: 'running' })
  }
  const progressMatch = p.match(/^\/api\/runs\/briefing\/(\d+)\/progress$/)
  if (progressMatch) {
    return json(res, 200, {
      runId: Number(progressMatch[1]), status: 'done', stage: 'done', stageLabel: '已完成',
      done: 42, total: 42, cancelled: false,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    })
  }
  const cancelMatch = p.match(/^\/api\/runs\/briefing\/(\d+)\/cancel$/)
  if (cancelMatch && req.method === 'POST') return json(res, 200, { ok: true })

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

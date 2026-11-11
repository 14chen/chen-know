// 抓 Gitee 榜单，输出 JSON 供后端摄入（data/weekly-gitee.json）。
//
// 为什么不再「打开 gitee.com/explore/all 解析 innerText」：
// 2026-11 起 Gitee 给 /explore/* 上了百度滑块验证码（真浏览器也会被拦成
// 「安全验证码-独立验证」），官方 /api/v5/search/repositories 匿名调用则稳定返回
// 空数组（必须有 access_token）。所以改成三条来源，按顺序降级：
//   1) 官方 API（有 token 时最稳）—— .kb-local.env 里的 KB_WEEKLY_GITEE_TOKEN
//   2) so.gitee.com 站内搜索后端（Gitee 搜索页自己用的接口，无验证码、无需登录）
//   3) gitee.com/gvp/all 精选页（HTML 卡片，最后兜底）
// 三者都只能「按 Star 排序」，Gitee 已不再对外提供真正的 trending 榜单；
// 这里再用 ISO 周的窗口轮换，避免每周推同一批项目。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const OUT = process.argv[2] || 'data/weekly-gitee.json'
const LIMIT = Number(process.argv[3] || 5)
const SITE = 'https://so.gitee.com/v1/search/widget/wong1slagnlmzwvsu5ya?query=1048'
const MIN_STARS = 300
const MAX_AGE_DAYS = 45
// 关键词轮换：站内搜索必须带 q，单个词的结果高度同质（「开源」全是 Java 后台脚手架）
const KEYWORDS = ['AI', '大模型', '数据库', 'Rust', 'Go', 'Python', '前端', '工具', 'Java', '开源']

function log(msg) { console.log('  ' + msg) }

function isoWeek(date) {
  const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7)
}

/** 读仓库根的 .kb-local.env（只认 KEY=VALUE，失败就当没有）。 */
function loadEnv() {
  const root = resolve(dirname(resolve(OUT)), '..')
  const file = resolve(root, '.kb-local.env')
  const env = {}
  if (!existsSync(file)) return env
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return env
}

async function httpText(url, accept, timeoutMs) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept, 'user-agent': 'kb-weekly/1.0 (+https://gitee.com)' },
        signal: AbortSignal.timeout(timeoutMs || 20000),
      })
      const text = await res.text()
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 120))
      return text
    } catch (e) {
      lastError = e
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 800))
    }
  }
  throw lastError
}

function describe(repo, stars, updatedAt, desc) {
  const clean = String(desc || '').replace(/\s+/g, ' ').trim()
  return { repo, stars, desc: clean.slice(0, 240), updatedAt: updatedAt || null }
}

/** 来源 1：官方 API。Gitee 没有 trending 接口，只能用搜索按 Star 排。 */
async function fromTokenApi(token, keyword, size) {
  const url = 'https://gitee.com/api/v5/search/repositories?q=' + encodeURIComponent(keyword)
    + '&sort=stars_count&order=desc&per_page=' + size + '&access_token=' + encodeURIComponent(token)
  const rows = JSON.parse(await httpText(url, 'application/json'))
  if (!Array.isArray(rows)) throw new Error('官方 API 返回的不是数组')
  return rows.map(r => describe(r.full_name, Number(r.stargazers_count) || 0,
    (r.updated_at || '').slice(0, 10), r.description))
}

/** 来源 2：so.gitee.com 站内搜索后端（搜索页用的就是它，sort_by_f 是「排序方式」原文）。 */
async function fromSiteSearch(keyword, size) {
  const url = SITE + '&q=' + encodeURIComponent(keyword) + '&from=0&size=' + size
    + '&sort_by_f=' + encodeURIComponent('Star 数')
  const json = JSON.parse(await httpText(url, 'application/json', 15000))
  const hits = (json.hits && json.hits.hits) || []
  return hits.map(h => {
    const f = h.fields || {}
    const pick = k => (Array.isArray(f[k]) ? f[k][0] : '')
    // title 是展示名（可能带空格，如「牛之云科技/NIUSHOP 开源商城 V6」），真实路径在 url 里
    const repo = String(pick('url') || '').replace(/^https?:\/\/gitee\.com\//, '').replace(/[?#].*$/, '').replace(/\/$/, '') || pick('title')
    return describe(repo, Number(pick('count.star')) || 0,
      String(pick('last_push_at') || '').slice(0, 10), pick('description'))
  })
}

/** 来源 3：GVP 精选页（服务端渲染的卡片，无验证码）。 */
async function fromGvp(size) {
  const html = await httpText('https://gitee.com/gvp/all', 'text/html')
  const cards = []
  const cardRe = /<a target="_blank" href="\/([^"]+)">([\s\S]*?)<\/a>/g
  let m
  while ((m = cardRe.exec(html))) {
    const href = m[1]
    const body = m[2]
    if (href.startsWith('gvp/') || href.startsWith('language/') || !/project-metas/.test(body)) continue
    const raw = (body.match(/icon-star'><\/i>\s*<span>([^<]*)<\/span>/) || [])[1] || ''
    const value = parseFloat(raw)
    const stars = !isFinite(value) ? 0 : (/k$/i.test(raw.trim()) ? Math.round(value * 1000) : Math.round(value))
    const desc = (body.match(/class='project-description' title='([^']*)'/) || [])[1] || ''
    cards.push(describe(href, stars, null, desc.replace(/&#39;/g, "'")))
  }
  return cards.slice(0, size)
}

/** 过滤 + 去重 + 按 Star 排序 + 按周轮换窗口。 */
function select(pool, limit, week) {
  const now = Date.now()
  const seen = new Set()
  const kept = []
  for (const item of pool) {
    if (!item.repo || !item.repo.includes('/')) continue
    if (item.stars < MIN_STARS) continue
    if (item.updatedAt) {
      const days = Math.floor((now - Date.parse(item.updatedAt)) / 86400000)
      if (isFinite(days) && days > MAX_AGE_DAYS) continue
    }
    const key = item.repo.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(item)
  }
  kept.sort((a, b) => b.stars - a.stars)
  // 只在高星头部里轮换：全池轮换会滑到 1 万星以下的小项目，读起来不像「榜单」
  const head = kept.slice(0, Math.min(kept.length, limit * 6))
  if (head.length === 0) return []
  const start = (week * limit) % head.length
  const picked = []
  for (let i = 0; i < Math.min(limit, head.length); i++) picked.push(head[(start + i) % head.length])
  return picked
}

const week = isoWeek(new Date())
const keywords = [KEYWORDS[week % KEYWORDS.length], KEYWORDS[(week + 3) % KEYWORDS.length]]
const env = loadEnv()
const token = process.env.KB_WEEKLY_GITEE_TOKEN || process.env.GITEE_TOKEN || env.KB_WEEKLY_GITEE_TOKEN || env.GITEE_TOKEN || ''

let items = []
let source = ''
let metric = ''
if (token) {
  try {
    const pool = []
    for (const kw of keywords) pool.push(...await fromTokenApi(token, kw, 60))
    items = select(pool, LIMIT, week)
    source = 'https://gitee.com/api/v5/search/repositories（关键词：' + keywords.join('/') + '，按 Star 排序）'
    metric = '官方 API + Star 排序；Gitee 无公开 trending 榜单，按 ISO 周轮换窗口避免重复'
    log('官方 API：候选 ' + pool.length + '，选中 ' + items.length)
  } catch (e) {
    log('官方 API 失败，改用站内搜索：' + e.message)
  }
}
if (items.length === 0) {
  const pool = []
  for (const kw of keywords) {
    try { pool.push(...await fromSiteSearch(kw, 60)) } catch (e) { log('站内搜索「' + kw + '」失败：' + e.message) }
  }
  items = select(pool, LIMIT, week)
  source = 'https://so.gitee.com 站内搜索（关键词：' + keywords.join('/') + '，按 Star 排序）'
  metric = 'Gitee explore 已上滑块验证码、官方 API 需要 token；此处用站内搜索的「近 ' + MAX_AGE_DAYS + ' 天活跃 + Star 排序」代替，并按 ISO 周轮换'
  log('站内搜索：候选 ' + pool.length + '，选中 ' + items.length)
}
if (items.length === 0) {
  try {
    items = select(await fromGvp(200), LIMIT, week)
    source = 'https://gitee.com/gvp/all (GVP 精选)'
    metric = '站内搜索也没拿到数据，退回 GVP 精选列表（按 Star 排序 + 周轮换）'
    log('GVP 兜底：选中 ' + items.length)
  } catch (e) {
    log('GVP 兜底失败：' + e.message)
  }
}

if (items.length === 0) {
  console.error('Gitee 三个来源都没有拿到数据，保留原文件不动：' + OUT)
  process.exit(1)
}
for (const t of items) {
  log(t.repo.padEnd(34) + String(t.stars).padStart(8) + '  ' + (t.updatedAt || '-') + '  ' + t.desc.slice(0, 40))
}
writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), source, metric, items }, null, 2) + '\n', 'utf8')
log('已写入 ' + OUT)

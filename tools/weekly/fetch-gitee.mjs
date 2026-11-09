// 抓 Gitee「最新推荐」榜单，输出 JSON 供后端摄入。
// 为什么必须用浏览器：gitee.com/explore/* 有 Nox JS 挑战，普通 HTTP 一律 405。
// 解析策略：取整页 innerText 按文本模式解析，比挖 DOM 稳（文本里的 owner/repo 大小写是准的）。
import { launch } from '../verify/cdp.mjs'
import { writeFileSync } from 'node:fs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const OUT = process.argv[2] || 'D:/deepseekhums/work/知识库/data/weekly-gitee.json'
const LIMIT = Number(process.argv[3] || 5)
const b = await launch({ width: 1440, height: 1600, scale: 1 })
try {
  const p = await b.newPage('https://gitee.com/explore/all')
  await p.waitForLoad()
  await sleep(7000)
  const text = String(await p.eval('document.body.innerText'))
  const rows = text.split('\n').map(s => s.trim())
  // 注意：Gitee 允许中文 owner（如「若依/RuoYi」），正则必须放行 CJK，否则会漏掉这类项目
  const REPO = /^[\w\u4e00-\u9fff][\w\u4e00-\u9fff.-]*\/[\w\u4e00-\u9fff][\w\u4e00-\u9fff.-]*$/u
  const STAR = /^([\d.]+)\s*K$/
  const items = []
  for (let i = 0; i < rows.length; i++) {
    if (!REPO.test(rows[i])) continue
    let j = i + 1
    if (rows[j] === 'GVP') j++
    const m = (rows[j] || '').match(STAR)
    if (!m) continue
    const stars = Math.round(parseFloat(m[1]) * 1000)
    let desc = ''
    for (let k = j + 1; k < Math.min(j + 4, rows.length); k++) {
      const t = rows[k]
      if (!t || /^[\d.]+\s*K$/.test(t) || t === '|') continue
      desc = t; break
    }
    // 最近更新时间：Gitee 列表里是「N天前 / N小时前 / N个月前 / 刚刚」这类相对时间，
    // 这里换算成 ISO 日期（拿不到就不写该字段，后端会整行省略，不写「未知」）
    let updatedAt = null
    for (let k = j + 1; k < Math.min(j + 6, rows.length); k++) {
      const rel = (rows[k] || '').match(/^(\d+)\s*(分钟|小时|天|周|个月|月|年)前$/)
      if (!rel) continue
      const n = Number(rel[1])
      const unit = rel[2]
      const days = unit === '分钟' || unit === '小时' ? 0
        : unit === '天' ? n
        : unit === '周' ? n * 7
        : unit === '个月' || unit === '月' ? n * 30
        : n * 365
      const when = new Date(Date.now() - days * 86400000)
      updatedAt = when.toISOString().slice(0, 10)
      break
    }
    items.push({ repo: rows[i], stars, desc: desc.slice(0, 240), updatedAt })
    if (items.length >= LIMIT) break
  }
  console.log('  解析到 ' + items.length + ' 个项目')
  for (const t of items) console.log('    ' + t.repo.padEnd(30) + String(t.stars).padStart(7) + '  ' + (t.updatedAt || '-') + '  ' + t.desc.slice(0, 40))
  writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), source: 'https://gitee.com/explore/all (最新推荐)', metric: 'Gitee 无周增星数据；本次用最新推荐榜，后端自第二次运行起改用 star 快照算真实周增', items }, null, 2), 'utf8')
  console.log('  已写入 ' + OUT)
} catch (e) { console.error('异常: ' + e.message) } finally { await b.close() }
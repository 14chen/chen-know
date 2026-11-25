/**
 * 开源周报总览（P1 / weekly-experience）—— 只改网页视图，10 篇周报笔记不动。
 * 周选择器 + Top3 解读 + 主题筛选 + 星增 sparkline + 项目详情。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { describeApiError, request } from '@/api/client'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from '@/views/types'

interface WeekRow { isoWeek: string; projects: number }
interface Project {
  source: string; repo: string; title: string; noteId: number | null; url: string | null
  totalStars: number | null; weeklyStars: number | null; language: string | null
  rank: number; theme: string; openIssues: number | null; forks: number | null
}
interface Highlight { project: Project; keyPoints: string[]; whyItMatters: string | null; risks: string | null; aiGenerated: boolean }
interface Detail { isoWeek: string; projects: Project[]; highlights: Highlight[]; themes: Record<string, number> }
interface StarPoint { capturedAt: string; stars: number; delta: number | null }

const THEMES = ['模型', '产品', '研究', '政策', '工具']

/** 内联 SVG sparkline：无外部依赖，跟随 currentColor。 */
function Sparkline({ points }: { points: StarPoint[] }) {
  if (points.length < 2) return <span className="vw-weekly__faint">快照不足，下周起显示趋势</span>
  const values = points.map((p) => p.stars)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const width = 180
  const height = 40
  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - ((value - min) / span) * (height - 6) - 3
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg className="vw-weekly__spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="最近几周星标趋势">
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

export default function WeeklyOverview({ ctx }: { ctx: ViewProps['ctx'] }) {
  const [weeks, setWeeks] = useState<WeekRow[]>([])
  const [isoWeek, setIsoWeek] = useState(ctx.params.week ?? '')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [theme, setTheme] = useState('')
  const [stars, setStars] = useState<Record<string, StarPoint[]>>({})
  const [selected, setSelected] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const drawerRef = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    let alive = true
    request<WeekRow[]>('/api/weekly/weeks')
      .then((rows) => {
        if (!alive) return
        setWeeks(rows)
        if (!isoWeek && rows.length) setIsoWeek(rows[0].isoWeek)
        setLoading(false)
      })
      .catch((err) => { if (alive) { setError(describeApiError(err)); setLoading(false) } })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!isoWeek) return
    let alive = true
    setLoading(true)
    setError('')
    request<Detail>(`/api/weekly/week/${encodeURIComponent(isoWeek)}`)
      .then((data) => {
        if (!alive) return
        setDetail(data)
        setLoading(false)
      })
      .catch((err) => { if (alive) { setError(describeApiError(err)); setLoading(false) } })
    return () => { alive = false }
  }, [isoWeek])

  // Top3 的 sparkline 按需加载（最多 3 个请求）
  useEffect(() => {
    if (!detail) return
    let alive = true
    Promise.all(detail.highlights.map((h) => request<StarPoint[]>(
      `/api/weekly/repos/stars?source=${encodeURIComponent(h.project.source)}&repo=${encodeURIComponent(h.project.repo)}&weeks=8`,
    ).then((points) => [h.project.source + ':' + h.project.repo, points] as const)))
      .then((pairs) => { if (alive) setStars(Object.fromEntries(pairs)) })
      .catch(() => { /* 趋势失败不影响总览 */ })
    return () => { alive = false }
  }, [detail])

  useEffect(() => {
    const dialog = drawerRef.current
    if (!dialog) return
    if (selected && !dialog.open) dialog.showModal()
    if (!selected && dialog.open) dialog.close()
  }, [selected])

  const chooseWeek = useCallback((value: string) => {
    setIsoWeek(value)
    setTheme('')
    ctx.navigate('weekly', { week: value })
  }, [ctx])

  const projects = (detail?.projects ?? []).filter((p) => !theme || p.theme === theme)

  if (error) return <p className="vw-weekly__strip is-error" role="alert">周报总览加载失败：{error}</p>
  if (loading && !detail) return <div className="vw-weekly__cards" aria-busy="true"><Skeleton width="100%" height={120} /></div>
  if (weeks.length === 0) return null

  return (
    <section className="vw-weekly__overview">
      <div className="vw-weekly__overview-head">
        <h2 className="vw-weekly__card-title">周报总览</h2>
        <label className="vw-weekly__weekpick">
          <span className="kb-visually-hidden">选择周次</span>
          <select value={isoWeek} onChange={(event) => chooseWeek(event.target.value)}>
            {weeks.map((row) => <option key={row.isoWeek} value={row.isoWeek}>{row.isoWeek}（{row.projects} 个项目）</option>)}
          </select>
        </label>
      </div>

      <h3 className="vw-weekly__subhead">本周 Top3 解读</h3>
      <div className="vw-weekly__highlights">
        {(detail?.highlights ?? []).map((h) => (
          <article className="vw-weekly__highlight" key={h.project.source + h.project.repo}>
            <div className="vw-weekly__highlight-head">
              <Badge tone="neutral">第 {h.project.rank} 名</Badge>
              <strong>{h.project.repo}</strong>
              {h.aiGenerated ? <Badge tone="success">AI 解读</Badge> : null}
            </div>
            {h.project.weeklyStars != null ? (
              <p className="vw-weekly__delta">本周 +{h.project.weeklyStars.toLocaleString()} ⭐</p>
            ) : (
              <p className="vw-weekly__faint">新进榜 · 基线建立中</p>
            )}
            <Sparkline points={stars[h.project.source + ':' + h.project.repo] ?? []} />
            {h.project.openIssues != null || h.project.forks != null ? (
              <p className="vw-weekly__faint">
                {h.project.openIssues != null ? `开放 issue/PR ${h.project.openIssues.toLocaleString()}` : null}
                {h.project.openIssues != null && h.project.forks != null ? ' · ' : null}
                {h.project.forks != null ? `fork ${h.project.forks.toLocaleString()}` : null}
              </p>
            ) : null}
            {h.whyItMatters ? <p>{h.whyItMatters}</p> : null}
            {h.keyPoints.length ? <ul>{h.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul> : null}
            {h.project.noteId ? (
              <Button size="sm" variant="ghost" onClick={() => ctx.openNote(h.project.noteId!)}>打开笔记</Button>
            ) : null}
          </article>
        ))}
      </div>

      <div className="vw-weekly__themes" role="group" aria-label="按主题筛选">
        <button type="button" className={!theme ? 'is-active' : ''} onClick={() => setTheme('')}>全部</button>
        {THEMES.map((name) => (
          <button type="button" key={name} className={theme === name ? 'is-active' : ''} onClick={() => setTheme(name)}>{name}</button>
        ))}
      </div>
      {projects.length === 0 ? (
        <EmptyState title="没有匹配的项目" desc="换个主题试试。" />
      ) : (
        <ul className="vw-weekly__projlist">
          {projects.map((p) => (
            <li key={p.source + p.repo}>
              <button type="button" onClick={() => setSelected(p)}>
                <span className="vw-weekly__projrank">#{p.rank}</span>
                <strong>{p.repo}</strong>
                <span className="vw-weekly__faint">{p.theme} · {p.source}</span>
                <span className="vw-weekly__projdelta">
                  {p.weeklyStars != null ? `+${p.weeklyStars.toLocaleString()}` : '新进榜'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <dialog ref={drawerRef} className="vw-weekly__drawer" aria-label="项目详情"
        onCancel={(event) => { event.preventDefault(); setSelected(null) }}
        onClick={(event) => { if (event.target === event.currentTarget) setSelected(null) }}>
        {selected ? (
          <>
            <div className="vw-weekly__drawer-head">
              <h3>{selected.repo}</h3>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>关闭</Button>
            </div>
            <p className="vw-weekly__faint">{selected.source} · 第 {selected.rank} 名 · {selected.theme}</p>
            {selected.totalStars != null ? <p>总星 {selected.totalStars.toLocaleString()}</p> : null}
            {selected.openIssues != null ? <p>开放 issue / PR：{selected.openIssues.toLocaleString()}</p> : null}
            {selected.forks != null ? <p>fork：{selected.forks.toLocaleString()}</p> : null}
            {selected.language ? <p>语言：{selected.language}</p> : null}
            {selected.weeklyStars == null ? <p className="vw-weekly__faint">新进榜 · 基线建立中，下周起显示真实周增。</p> : null}
            {selected.url ? <a className="vw-brief__link" href={selected.url} target="_blank" rel="noopener noreferrer">打开仓库</a> : null}
            {selected.noteId ? <div><Button size="sm" onClick={() => ctx.openNote(selected.noteId!)}>打开周报笔记</Button></div> : null}
          </>
        ) : null}
      </dialog>
    </section>
  )
}

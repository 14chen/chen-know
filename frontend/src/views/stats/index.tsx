/**
 * 统计视图 —— 路由 `#/stats`（契约 docs/API.md §9）
 *
 * 计数卡片 + 最近 14 天创建趋势（纯 CSS 柱状图，不引图表库；无数据日期补 0 也要有柱子）
 * + 最近更新（复用 `GET /api/recent?limit=5`）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { describeApiError, request } from '@/api/client'
import type { RecentItem, RecentResponse, StatsResponse } from '@/api/types'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from '@/views/types'

type Status = 'loading' | 'ready' | 'error'

/** 千分位（不依赖 Intl，输出稳定可断言） */
function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** `2026-10-16` → `10-16` */
function shortDate(date: string): string {
  return date.length >= 10 ? date.slice(5, 10) : date
}

interface Metric {
  key: keyof StatsResponse
  label: string
  hint: string
  /** 该卡片点击后跳转的视图 */
  to?: string
  bytes?: boolean
}

const METRICS: Metric[] = [
  { key: 'noteCount', label: '笔记', hint: '未删除的笔记总数' },
  { key: 'folderCount', label: '目录', hint: '目录树节点总数' },
  { key: 'tagCount', label: '标签', hint: '使用中的标签数' },
  { key: 'attachmentCount', label: '附件', hint: '已上传的附件数' },
  { key: 'totalAttachmentBytes', label: '附件占用', hint: '磁盘上的附件总大小', bytes: true },
  { key: 'trashCount', label: '回收站', hint: '可恢复的条目数，点击打开回收站', to: 'trash' },
  { key: 'updatedToday', label: '今日更新', hint: '今天改动过的笔记数' },
]

export default function StatsView({ ctx }: ViewProps) {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [recent, setRecent] = useState<RecentItem[]>([])
  const [recentStatus, setRecentStatus] = useState<Status>('loading')
  const [recentError, setRecentError] = useState('')

  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    setRecentStatus('loading')
    try {
      const [statsData, recentData] = await Promise.all([
        request<StatsResponse>('/api/stats', { signal: controller.signal }),
        request<RecentResponse>('/api/recent?limit=5', { signal: controller.signal }),
      ])
      if (controller.signal.aborted) return
      setStats(statsData)
      setRecent(recentData.items)
      setStatus('ready')
      setRecentStatus('ready')
    } catch (err) {
      if (controller.signal.aborted) return
      setError(describeApiError(err))
      setStatus('error')
      setRecentError(describeApiError(err))
      setRecentStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      abortRef.current?.abort()
    }
  }, [load])

  return (
    <div className="kb-adm kb-adm--stats">
      <header className="kb-adm__head">
        <div className="kb-adm__heading">
          <h1 className="kb-adm__title">统计</h1>
          <p className="kb-adm__sub">空间概览与最近创建趋势</p>
        </div>
        <div className="kb-adm__actions">
          <Button size="sm" onClick={() => void load()} disabled={status === 'loading'}>
            刷新
          </Button>
        </div>
      </header>

      <div className="kb-adm__body">
        {status === 'loading' ? (
          <div className="kb-adm__stack" aria-busy="true">
            <div className="kb-adm-grid">
              {METRICS.map((metric) => (
                <div key={metric.key} className="kb-adm-stat">
                  <Skeleton width="48%" height={22} />
                  <Skeleton width="70%" height={11} />
                </div>
              ))}
            </div>
            <div className="kb-adm-card">
              <div className="kb-adm-card__body">
                <Skeleton width="30%" height={13} />
                <Skeleton width="100%" height={120} />
              </div>
            </div>
          </div>
        ) : null}

        {status === 'error' ? (
          <EmptyState
            title="统计加载失败"
            desc={error}
            action={
              <Button size="sm" onClick={() => void load()}>
                重试
              </Button>
            }
          />
        ) : null}

        {status === 'ready' && stats ? (
          <div className="kb-adm__stack">
            <div className="kb-adm-grid">
              {METRICS.map((metric) => {
                const raw = stats[metric.key]
                const value = typeof raw === 'number' ? raw : 0
                const text = metric.bytes ? ctx.formatBytes(value) : formatCount(value)
                const body = (
                  <>
                    <span className="kb-adm-stat__value">{text}</span>
                    <span className="kb-adm-stat__label">{metric.label}</span>
                  </>
                )
                return metric.to ? (
                  <button
                    key={metric.key}
                    type="button"
                    className="kb-adm-stat is-link"
                    title={metric.hint}
                    onClick={() => ctx.navigate(metric.to as string)}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={metric.key} className="kb-adm-stat" title={metric.hint}>
                    {body}
                  </div>
                )
              })}
            </div>

            <section className="kb-adm-card">
              <div className="kb-adm-card__head">
                <h2 className="kb-adm-card__title">最近 14 天创建趋势</h2>
                <p className="kb-adm-card__sub">按笔记创建日期统计，暂无数据的日期计为 0</p>
              </div>
              <div className="kb-adm-card__body">
                <BarChart days={stats.dailyCreated} />
              </div>
            </section>

            <section className="kb-adm-card">
              <div className="kb-adm-card__head">
                <h2 className="kb-adm-card__title">最近更新</h2>
                <p className="kb-adm-card__sub">最近打开或改动过的笔记</p>
              </div>
              <div className="kb-adm-card__body">
                {recentStatus === 'loading' ? <Skeleton width="70%" height={13} /> : null}
                {recentStatus === 'error' ? <p className="kb-adm-faint">最近更新加载失败：{recentError}</p> : null}
                {recentStatus === 'ready' && recent.length === 0 ? (
                  <p className="kb-adm-faint">还没有浏览记录，打开一篇笔记后这里会显示。</p>
                ) : null}
                {recentStatus === 'ready' && recent.length > 0 ? (
                  <ul className="kb-adm-recent">
                    {recent.map((item) => (
                      <li key={item.noteId}>
                        <button
                          type="button"
                          className="kb-adm-recent__item"
                          title={`打开「${item.title || '（无标题）'}」`}
                          onClick={() => ctx.openNote(item.noteId)}
                        >
                          <span className="kb-adm-recent__main">
                            <span className="kb-adm-recent__title">{item.title || '（无标题）'}</span>
                            {item.excerpt ? <span className="kb-adm-faint kb-adm-truncate">{item.excerpt}</span> : null}
                          </span>
                          <span className="kb-adm-faint">{ctx.relativeTime(item.viewedAt)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 纯 CSS 柱状图：柱高按最大值归一化；0 值日期保留 2% 的可见底座 */
function BarChart({ days }: { days: { date: string; count: number }[] }) {
  if (days.length === 0) {
    return <p className="kb-adm-faint">暂无趋势数据。</p>
  }
  const max = days.reduce((acc, day) => Math.max(acc, day.count), 0)
  const scale = max > 0 ? max : 1

  return (
    <div className="kb-adm-chart">
      <p className="kb-adm-chart__legend">
        <span>峰值 {formatCount(max)} 篇 / 天</span>
        <span className="kb-adm-faint">
          近 {days.length} 天合计 {formatCount(days.reduce((acc, day) => acc + day.count, 0))} 篇
        </span>
      </p>
      <div className="kb-adm-chart__bars" role="img" aria-label={`最近 ${days.length} 天创建趋势`}>
        {days.map((day) => {
          const height = day.count > 0 ? Math.max(3, Math.round((day.count / scale) * 1000) / 10) : 2
          return (
            <div
              key={day.date}
              className={`kb-adm-chart__col${day.count > 0 ? '' : ' is-zero'}`}
              data-date={day.date}
              data-count={day.count}
              title={`${shortDate(day.date)}：创建 ${day.count} 篇`}
            >
              <span className="kb-adm-chart__tip">{`${shortDate(day.date)} · ${day.count} 篇`}</span>
              <span className="kb-adm-chart__bar" style={{ height: `${height}%` }}>
                {day.count > 0 ? <span className="kb-adm-chart__num">{day.count}</span> : null}
              </span>
            </div>
          )
        })}
      </div>
      <div className="kb-adm-chart__axis" aria-hidden="true">
        {days.map((day) => (
          <span key={day.date}>{shortDate(day.date)}</span>
        ))}
      </div>
    </div>
  )
}

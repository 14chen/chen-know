/**
 * 每日 AI 简报 —— 路由 `#/briefing`（契约 docs/BRIEFING.md §6 / §7）
 *
 * 三块内容：立即生成 + 结果回显、源状态表、运行历史表；三态齐全（骨架屏 / 空态 / 错误态）。
 * 视觉命名空间统一 `vw-brief-`，样式写在 styles/views-admin.css 的简报段落。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, describeApiError, request } from '@/api/client'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from '@/views/types'

/* ---------------------------------------------------------------- 契约类型 */

/** §2 source_report：库里存的是 JSON 字符串，接口也可能直接给数组 —— 两种都要能收 */
export interface SourceReportItem {
  source: string
  ok: boolean
  count: number
  error?: string | null
}

export interface BriefingSource {
  id: number
  name: string
  url: string
  kind: string
}

export interface BriefingRun {
  id: number
  startedAt: string
  finishedAt?: string | null
  status: string
  totalItems: number
  newItems: number
  noteId?: number | null
  sourceReport?: unknown
}

export function parseSourceReport(raw: unknown): SourceReportItem[] {
  if (!raw) return []
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      source: String(item.source ?? ''),
      ok: item.ok !== false,
      count: Number(item.count ?? 0) || 0,
      error: item.error == null ? null : String(item.error),
    }))
}

const STATUS_TEXT: Record<string, string> = {
  running: '进行中',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
}

const KIND_TEXT: Record<string, string> = { rss: 'RSS', html: 'HTML', json: 'JSON' }

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'success') return 'success'
  if (status === 'partial') return 'warning'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

/* ---------------------------------------------------------------- 视图 */

export default function BriefingView({ ctx }: ViewProps) {
  const [sources, setSources] = useState<BriefingSource[]>([])
  const [runs, setRuns] = useState<BriefingRun[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<BriefingRun | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('loading')
    setError('')
    try {
      const [sourceData, runData] = await Promise.all([
        request<{ items: BriefingSource[] }>('/api/briefing/sources', { signal: controller.signal }),
        request<{ items: BriefingRun[] }>('/api/briefing/runs?limit=10', { signal: controller.signal }),
      ])
      if (controller.signal.aborted) return
      setSources(sourceData.items ?? [])
      setRuns(runData.items ?? [])
      setPhase('ready')
    } catch (err) {
      if (controller.signal.aborted) return
      setError(describeApiError(err))
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      abortRef.current?.abort()
    }
  }, [load])

  const runNow = useCallback(async () => {
    if (running) return
    setRunning(true)
    try {
      const data = await request<BriefingRun>('/api/briefing/run', { method: 'POST' })
      setLastRun(data)
      const noteId = data.noteId ?? null
      ctx.toast.success(
        `简报已生成：新内容 ${data.newItems} 条 / 共检查 ${data.totalItems} 条` +
          (noteId ? '，点击「打开简报」查看' : ''),
      )
      await load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        ctx.toast.warn('已有简报任务在进行中，请稍后再试')
      } else {
        ctx.toast.error(`生成简报失败：${describeApiError(err)}`)
      }
    } finally {
      setRunning(false)
    }
  }, [ctx, load, running])

  const latestReport = (runs[0]?.sourceReport ?? lastRun?.sourceReport) as unknown
  const reportItems = parseSourceReport(latestReport)
  const reportBySource = new Map(reportItems.map((item) => [item.source, item]))
  const sourceFailures = reportItems.filter((item) => !item.ok).length

  return (
    <div className="vw-brief">
      <header className="vw-brief__head">
        <div className="vw-brief__heading">
          <h1 className="vw-brief__title">AI 简报</h1>
          <p className="vw-brief__sub">
            每日抓取 {sources.length > 0 ? sources.length : '多'} 个 AI 源，去重后归档成一篇笔记
          </p>
        </div>
        <div className="vw-brief__actions">
          <Button variant="primary" loading={running} onClick={() => void runNow()}>
            {running ? '正在生成…' : '立即生成简报'}
          </Button>
          <Button onClick={() => void load()} disabled={phase === 'loading' || running}>
            刷新
          </Button>
        </div>
      </header>

      <div className="vw-brief__body">
        {running ? (
          <p className="vw-brief__progress" role="status">
            正在抓取各源并生成简报，单个源最长等待 15 秒，请稍候…
          </p>
        ) : null}

        {lastRun ? (
          <section className="vw-brief__result" aria-live="polite">
            <p className="vw-brief__result-title">
              本次生成完成：新内容 <strong>{lastRun.newItems}</strong> 条 / 共检查{' '}
              <strong>{lastRun.totalItems}</strong> 条
            </p>
            <p className="vw-brief__result-meta">
              <Badge tone={statusTone(lastRun.status)}>{STATUS_TEXT[lastRun.status] ?? lastRun.status}</Badge>
              <span className="vw-brief__faint">来源 {reportItems.length} 个</span>
              {sourceFailures > 0 ? (
                <span className="vw-brief__faint">其中 {sourceFailures} 个源本次未取到</span>
              ) : null}
            </p>
            {lastRun.noteId ? (
              <Button size="sm" onClick={() => ctx.openNote(Number(lastRun.noteId))}>
                打开简报
              </Button>
            ) : null}
          </section>
        ) : null}

        {phase === 'loading' ? <BriefingSkeleton /> : null}

        {phase === 'error' ? (
          <div className="vw-brief__state">
            <EmptyState
              title="加载失败"
              desc={error || '无法读取简报数据'}
              action={
                <Button variant="primary" onClick={() => void load()}>
                  重试
                </Button>
              }
            />
          </div>
        ) : null}

        {phase === 'ready' ? (
          <>
            <section className="vw-brief__card">
              <div className="vw-brief__card-head">
                <h2 className="vw-brief__card-title">源状态</h2>
                <p className="vw-brief__faint">
                  {sources.length} 个源 · 带状态的是最近一次运行的结果
                </p>
              </div>
              {sources.length === 0 ? (
                <p className="vw-brief__faint vw-brief__card-body">还没有配置源。</p>
              ) : (
                <div className="vw-brief__tablewrap">
                  <table className="vw-brief__table">
                    <thead>
                      <tr>
                        <th>源</th>
                        <th>类型</th>
                        <th>链接</th>
                        <th>最近一次</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.map((source) => {
                        const report = reportBySource.get(source.name)
                        return (
                          <tr key={source.id}>
                            <td className="vw-brief__cell-name">{source.name}</td>
                            <td>
                              <Badge tone="neutral">{KIND_TEXT[String(source.kind).toLowerCase()] ?? source.kind}</Badge>
                            </td>
                            <td className="vw-brief__cell-url">
                              <a
                                className="vw-brief__link"
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={source.url}
                              >
                                {source.url}
                              </a>
                            </td>
                            <td>
                              {report ? (
                                report.ok ? (
                                  <Badge tone="success">{report.count} 条</Badge>
                                ) : (
                                  <span title={report.error ?? ''}>
                                    <Badge tone="danger">未取到</Badge>
                                  </span>
                                )
                              ) : (
                                <span className="vw-brief__faint">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="vw-brief__card">
              <div className="vw-brief__card-head">
                <h2 className="vw-brief__card-title">运行历史</h2>
                <p className="vw-brief__faint">最近 {runs.length} 次</p>
              </div>
              {runs.length === 0 ? (
                <div className="vw-brief__card-body">
                  <EmptyState
                    title="还没有生成过简报"
                    desc="点上方「立即生成简报」抓取一次，第一条记录就会出现在这里。"
                    action={
                      <Button variant="primary" loading={running} onClick={() => void runNow()}>
                        立即生成简报
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="vw-brief__tablewrap">
                  <table className="vw-brief__table">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>状态</th>
                        <th className="vw-brief__cell-num">新内容</th>
                        <th className="vw-brief__cell-num">检查</th>
                        <th>笔记</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => (
                        <tr key={run.id}>
                          <td className="vw-brief__cell-time">{ctx.relativeTime(run.startedAt)}</td>
                          <td>
                            <Badge tone={statusTone(run.status)}>{STATUS_TEXT[run.status] ?? run.status}</Badge>
                          </td>
                          <td className="vw-brief__cell-num">{run.newItems}</td>
                          <td className="vw-brief__cell-num">{run.totalItems}</td>
                          <td>
                            {run.noteId ? (
                              <Button size="sm" variant="ghost" onClick={() => ctx.openNote(Number(run.noteId))}>
                                打开简报
                              </Button>
                            ) : (
                              <span className="vw-brief__faint">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}

function BriefingSkeleton() {
  return (
    <div className="vw-brief__skeleton" aria-busy="true">
      {[0, 1].map((card) => (
        <section className="vw-brief__card" key={card}>
          <div className="vw-brief__card-head">
            <Skeleton width={96} height={16} />
          </div>
          <div className="vw-brief__card-body vw-brief__skeleton-rows">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} width={row === 2 ? '62%' : '100%'} height={14} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

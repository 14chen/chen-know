/**
 * 简报条目面板（P1 / briefing-experience）—— 只改网页视图，note 正文格式不变。
 * Top5 候选 + 主题筛选 + 搜索分页 + 详情抽屉 + 反馈。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { describeApiError, request } from '@/api/client'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from '@/views/types'

export interface BriefingItemView {
  url: string
  title: string
  summary: string
  source: string
  theme: string
  qualityScore: number
  accepted: boolean
  rank: number
  keyPoints: string[]
  whyItMatters?: string | null
  relatedTitles: string[]
  engagement: number
  engagementLevel: number
  corroboration: number
  sourceLinks: string[]
  topQuote?: string | null
}

const THEMES = ['模型', '产品', '研究', '政策', '工具']

function ItemCard({ item, onOpen, feedback, onFeedback }: {
  item: BriefingItemView
  onOpen: () => void
  feedback?: string
  onFeedback: (value: string) => void
}) {
  return (
    <li className="vw-brief__pick-card">
      <button type="button" className="vw-brief__pick-main" onClick={onOpen}>
        <span className="vw-brief__pick-head">
          {item.engagement > 0 ? (
            <Badge tone={item.engagementLevel >= 3 ? 'success' : 'neutral'}>
              热度 {item.engagement}
            </Badge>
          ) : null}
          {item.corroboration > 1 ? (
            <Badge tone="accent">{item.corroboration} 个来源报道</Badge>
          ) : null}
          <Badge tone={item.qualityScore >= 70 ? 'success' : 'neutral'}>{item.qualityScore} 分</Badge>
          <Badge tone="neutral">{item.theme}</Badge>
          <span className="vw-brief__faint">{item.source}</span>
        </span>
        <strong className="vw-brief__pick-title">{item.title}</strong>
        {item.whyItMatters ? <span className="vw-brief__pick-why">{item.whyItMatters}</span> : null}
        {item.keyPoints.length > 0 ? (
          <span className="vw-brief__pick-points">{item.keyPoints.slice(0, 3).join(' · ')}</span>
        ) : null}
      </button>
      <span className="vw-brief__pick-actions">
        <button type="button" className={'vw-brief__fb' + (feedback === 'useful' ? ' is-on' : '')}
          aria-pressed={feedback === 'useful'} onClick={() => onFeedback('useful')}>有用</button>
        <button type="button" className={'vw-brief__fb' + (feedback === 'not_interesting' ? ' is-on' : '')}
          aria-pressed={feedback === 'not_interesting'} onClick={() => onFeedback('not_interesting')}>不感兴趣</button>
      </span>
    </li>
  )
}

export default function ItemsPanel({ ctx, runId }: { ctx: ViewProps['ctx']; runId: number | null }) {
  const [top, setTop] = useState<BriefingItemView[]>([])
  const [items, setItems] = useState<BriefingItemView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(ctx.params.theme ?? '')
  const [q, setQ] = useState(ctx.params.q ?? '')
  const [page, setPage] = useState(Number(ctx.params.page ?? '1') || 1)
  const [selected, setSelected] = useState<BriefingItemView | null>(null)
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const drawerRef = useRef<HTMLDialogElement | null>(null)

  // 原生 <dialog> + showModal()：浏览器负责 Escape 关闭、焦点管理与其余页面 inert
  useEffect(() => {
    const dialog = drawerRef.current
    if (!dialog) return
    if (selected && !dialog.open) dialog.showModal()
    if (!selected && dialog.open) dialog.close()
  }, [selected])

  const syncUrl = useCallback((next: { theme?: string; q?: string; page?: number }) => {
    ctx.navigate('briefing', {
      theme: next.theme || undefined,
      q: next.q || undefined,
      page: next.page && next.page > 1 ? next.page : undefined,
    })
  }, [ctx])

  useEffect(() => {
    if (runId === null) {
      setTop([]); setItems([]); setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const query = new URLSearchParams({
      runId: String(runId), page: String(page), size: '10',
    })
    if (theme) query.set('theme', theme)
    if (q.trim()) query.set('q', q.trim())
    Promise.all([
      request<{ items: BriefingItemView[] }>(`/api/briefing/runs/${runId}`, { signal: controller.signal }),
      request<{ items: BriefingItemView[] }>(`/api/briefing/items?${query.toString()}`, { signal: controller.signal }),
    ]).then(([detail, list]) => {
      if (controller.signal.aborted) return
      // 今日必读：先过质量门槛，再按真实互动量（热度）排序 —— 谁被更多人真正关注谁排前面
      setTop(detail.items
        .filter((item) => item.accepted && item.qualityScore >= 70)
        .sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0) || a.rank - b.rank)
        .slice(0, 5))
      setItems(list.items ?? [])
      setLoading(false)
    }).catch((err) => {
      if (controller.signal.aborted) return
      setError(describeApiError(err))
      setLoading(false)
    })
    return () => controller.abort()
  }, [runId, theme, q, page])

  const sendFeedback = useCallback(async (item: BriefingItemView, value: string) => {
    try {
      await request('/api/briefing/items/feedback', {
        method: 'POST', body: { url: item.url, feedback: value },
      })
      setFeedback((prev) => ({ ...prev, [item.url]: value }))
      ctx.toast.success('已记录反馈，下次排序会参考')
    } catch (err) {
      ctx.toast.error(`反馈失败：${describeApiError(err)}`)
    }
  }, [ctx])

  if (error) {
    return <p className="vw-brief__progress" role="alert">条目加载失败：{error}</p>
  }

  return (
    <>
      <section className="vw-brief__card">
        <div className="vw-brief__card-head">
          <h2 className="vw-brief__card-title">今日必读</h2>
          <p className="vw-brief__faint">质量分 ≥ 70 的候选中，按真实互动量（热度）取前 5 条；低分条目仍保留在下方全部条目</p>
        </div>
        {loading ? (
          <div className="vw-brief__skeleton" aria-busy="true"><Skeleton width="100%" height={72} /><Skeleton width="100%" height={72} /></div>
        ) : top.length === 0 ? (
          <div className="vw-brief__card-body">
            <EmptyState title="本期没有必读候选" desc="所有条目的质量分都低于 70，完整内容仍可在下方查看。" />
          </div>
        ) : (
          <ul className="vw-brief__pick">
            {top.map((item) => (
              <ItemCard key={item.url} item={item} onOpen={() => setSelected(item)}
                feedback={feedback[item.url]} onFeedback={(value) => void sendFeedback(item, value)} />
            ))}
          </ul>
        )}
      </section>

      <section className="vw-brief__card">
        <div className="vw-brief__card-head">
          <h2 className="vw-brief__card-title">全部条目</h2>
          <div className="vw-brief__filters">
            <label className="vw-brief__search">
              <span className="kb-visually-hidden">搜索条目</span>
              <input type="search" value={q} placeholder="搜索标题或摘要"
                onChange={(event) => { setQ(event.target.value); setPage(1); syncUrl({ theme, q: event.target.value, page: 1 }) }} />
            </label>
          </div>
        </div>
        <div className="vw-brief__themes" role="group" aria-label="按主题筛选">
          <button type="button" className={theme === '' ? 'is-active' : ''} onClick={() => { setTheme(''); setPage(1); syncUrl({ q, page: 1 }) }}>全部</button>
          {THEMES.map((name) => (
            <button type="button" key={name} className={theme === name ? 'is-active' : ''}
              onClick={() => { setTheme(name); setPage(1); syncUrl({ theme: name, q, page: 1 }) }}>{name}</button>
          ))}
        </div>
        {items.length === 0 ? (
          <div className="vw-brief__card-body"><EmptyState title="没有匹配的条目" desc="换个主题或关键词试试。" /></div>
        ) : (
          <ul className="vw-brief__pick">
            {items.map((item) => (
              <ItemCard key={item.url} item={item} onOpen={() => setSelected(item)}
                feedback={feedback[item.url]} onFeedback={(value) => void sendFeedback(item, value)} />
            ))}
          </ul>
        )}
        <div className="vw-brief__pager">
          <Button size="sm" disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); syncUrl({ theme, q, page: next }) }}>上一页</Button>
          <span className="vw-brief__faint">第 {page} 页</span>
          <Button size="sm" disabled={items.length < 10} onClick={() => { const next = page + 1; setPage(next); syncUrl({ theme, q, page: next }) }}>下一页</Button>
        </div>
      </section>

      <dialog
        ref={drawerRef}
        className="vw-brief__drawer"
        aria-label="条目详情"
        onCancel={(event) => { event.preventDefault(); setSelected(null) }}
        onClick={(event) => { if (event.target === event.currentTarget) setSelected(null) }}
      >
        {selected ? (
          <>
            <div className="vw-brief__drawer-head">
              <h3>{selected.title}</h3>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>关闭</Button>
            </div>
            <p className="vw-brief__faint">{selected.source} · {selected.theme} · 质量分 {selected.qualityScore}{selected.engagement > 0 ? ` · 热度 ${selected.engagement}` : ''}</p>
            <p>{selected.summary}</p>
            {selected.keyPoints.length > 0 ? (
              <>
                <h4>关键点</h4>
                <ul>{selected.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>
              </>
            ) : null}
            {selected.whyItMatters ? <><h4>为什么值得看</h4><p>{selected.whyItMatters}</p></> : null}
            {selected.topQuote ? (
              <blockquote className="vw-brief__quote">社区高赞原话：{selected.topQuote}</blockquote>
            ) : null}
            {selected.sourceLinks && selected.sourceLinks.length > 0 ? (
              <>
                <h4>多源印证（{selected.sourceLinks.length + 1} 个来源报道同一件事）</h4>
                <ul>
                  {selected.sourceLinks.map((link, index) => {
                    const sep = link.indexOf('|')
                    const name = sep > 0 ? link.slice(0, sep) : '来源'
                    const href = sep > 0 ? link.slice(sep + 1) : link
                    return (
                      <li key={index}>
                        {/^https?:\/\//i.test(href)
                          ? <a href={href} target="_blank" rel="noopener noreferrer">{name}</a>
                          : <span>{name}</span>}
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : null}
            {selected.relatedTitles.length > 0 ? (
              <>
                <h4>与你已有的笔记相关</h4>
                <ul>{selected.relatedTitles.map((title) => <li key={title}>《{title}》</li>)}</ul>
              </>
            ) : null}
            <a className="vw-brief__link" href={selected.url} target="_blank" rel="noopener noreferrer">打开原文</a>
            <div className="vw-brief__drawer-fb">
              <Button size="sm" onClick={() => void sendFeedback(selected, 'useful')}>有用</Button>
              <Button size="sm" variant="ghost" onClick={() => void sendFeedback(selected, 'not_interesting')}>不感兴趣</Button>
            </div>
          </>
        ) : null}
      </dialog>
    </>
  )
}

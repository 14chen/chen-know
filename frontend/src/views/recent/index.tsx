import { useCallback, useEffect, useMemo, useState } from 'react'
import { describeApiError, request } from '@/api/client'
import type { FolderNode, RecentItem, RecentResponse } from '@/api/types'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from '@/views/types'

const LIMITS = [10, 20, 50] as const

type Status = 'loading' | 'ready' | 'error'

interface FlatFolder {
  id: number
  name: string
}

function flattenFolders(nodes: FolderNode[], out: FlatFolder[] = []): FlatFolder[] {
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name })
    if (node.children.length > 0) flattenFolders(node.children, out)
  }
  return out
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export default function RecentView({ ctx }: ViewProps) {
  const [items, setItems] = useState<RecentItem[]>([])
  const [limit, setLimit] = useState<number>(20)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const folders = useMemo(() => flattenFolders(ctx.tree), [ctx.tree])

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    // 契约：{ items: RecentItem[] }，时间字段固定为 viewedAt（API.md §4.2）
    request<RecentResponse>(`/api/recent?limit=${limit}`, { signal: controller.signal })
      .then((result) => {
        const list = Array.isArray(result.items) ? result.items : []
        // 服务端已按 viewedAt 倒序，这里再兜一次，避免上游实现偏差
        setItems(
          [...list].sort((a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime()),
        )
        setStatus('ready')
        setError('')
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return
        setError(describeApiError(err))
        setStatus('error')
      })
    return () => controller.abort()
  }, [limit, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  const folderName = (id: number | null): string => {
    if (id === null) return '未分类'
    return folders.find((folder) => folder.id === id)?.name ?? `目录 #${id}`
  }

  return (
    <section className="vw" aria-label="最近浏览">
      <header className="vw__head">
        <h1 className="vw__title">最近浏览</h1>
        {status === 'ready' ? <span className="vw__count">{items.length} 条</span> : null}
        <div className="vw__actions">
          <Button size="sm" onClick={reload}>
            刷新
          </Button>
        </div>
      </header>

      <div className="vw__bar">
        <div className="kb-field">
          <label className="kb-field__label" htmlFor="vw-recent-limit">
            显示条数
          </label>
          <select
            id="vw-recent-limit"
            className="kb-select"
            value={String(limit)}
            onChange={(event) => setLimit(Number(event.target.value) || 20)}
          >
            {LIMITS.map((value) => (
              <option key={value} value={String(value)}>
                最近 {value} 条
              </option>
            ))}
          </select>
        </div>
        <span className="vw__count">按浏览时间倒序（viewedAt）</span>
      </div>

      <div className="vw__body">
        {status === 'loading' ? (
          <div className="vw-skeleton" aria-busy="true" aria-label="最近浏览加载中">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <Skeleton width="50%" height={16} />
                <Skeleton width="65%" />
              </div>
            ))}
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">⚠️</span>}
              title="最近浏览加载失败"
              desc={error}
              action={
                <Button variant="primary" onClick={reload}>
                  重试
                </Button>
              }
            />
          </div>
        ) : null}

        {status === 'ready' && items.length === 0 ? (
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">🕘</span>}
              title="还没有浏览记录"
              desc="打开任意笔记就会记一笔浏览；这里按时间倒序展示最近打开的笔记。"
            />
          </div>
        ) : null}

        {status === 'ready' && items.length > 0 ? (
          <ul className="vw-list">
            {items.map((item, index) => (
              <li key={`${item.noteId}-${item.viewedAt}`}>
                <button type="button" className="vw-row" onClick={() => ctx.openNote(item.noteId)}>
                  <span className="vw-row__main">
                    <span className="vw-row__title">
                      <span className="vw__count" style={{ marginRight: 'var(--sp-2)' }}>
                        {index + 1}
                      </span>
                      {item.title || `无标题 #${item.noteId}`}
                    </span>
                    <span className="vw-row__meta">
                      <span>{ctx.relativeTime(item.viewedAt)}</span>
                      <span className="vw-chip">{folderName(item.folderId)}</span>
                    </span>
                    {item.excerpt ? <span className="vw-row__sub">{item.excerpt}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}

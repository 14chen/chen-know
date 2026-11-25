import { useCallback, useEffect, useMemo, useState } from 'react'
import { describeApiError } from '@/api/client'
import { listFavorites, patchNote } from '@/api/notes'
import type { FolderNode, NoteListItem, Page } from '@/api/types'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from '@/views/types'

const PAGE_SIZE = 20

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

export default function FavoritesView({ ctx }: ViewProps) {
  const [data, setData] = useState<Page<NoteListItem> | null>(null)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const folders = useMemo(() => flattenFolders(ctx.tree), [ctx.tree])
  const pageCount = data ? Math.max(1, Math.ceil(data.total / (data.size || PAGE_SIZE))) : 1

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    // 契约：/api/favorites 是分页信封，items 元素与笔记列表项完全一致（API.md §4.3）
    listFavorites({ page, size: PAGE_SIZE, signal: controller.signal })
      .then((result) => {
        setData(result)
        setStatus('ready')
        setError('')
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return
        setError(describeApiError(err))
        setStatus('error')
      })
    return () => controller.abort()
  }, [page, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  const unfavorite = async (note: NoteListItem) => {
    if (busyId !== null) return
    setBusyId(note.id)
    try {
      await patchNote(note.id, { isFavorite: false })
      ctx.toast.success(`已取消收藏「${note.title || '无标题'}」`)
      setData((current) =>
        current
          ? { ...current, items: current.items.filter((item) => item.id !== note.id), total: Math.max(0, current.total - 1) }
          : current,
      )
      reload()
    } catch (err: unknown) {
      ctx.toast.error(`操作失败：${describeApiError(err)}`)
    } finally {
      setBusyId(null)
    }
  }

  const folderName = (id: number | null): string => {
    if (id === null) return '未分类'
    return folders.find((folder) => folder.id === id)?.name ?? `目录 #${id}`
  }

  return (
    <section className="vw" aria-label="收藏">
      <header className="vw__head">
        <h1 className="vw__title">收藏</h1>
        {status === 'ready' && data ? <span className="vw__count">{data.total} 篇</span> : null}
        <div className="vw__actions">
          <Button size="sm" onClick={reload}>
            刷新
          </Button>
        </div>
      </header>

      <div className="vw__body">
        {status === 'loading' ? (
          <div className="vw-skeleton" aria-busy="true" aria-label="收藏加载中">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <Skeleton width="45%" height={16} />
                <Skeleton width="70%" />
              </div>
            ))}
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">⚠️</span>}
              title="收藏列表加载失败"
              desc={error}
              action={
                <Button variant="primary" onClick={reload}>
                  重试
                </Button>
              }
            />
          </div>
        ) : null}

        {status === 'ready' && data && data.items.length === 0 ? (
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">⭐</span>}
              title="还没有收藏的笔记"
              desc="在左侧笔记列表的「⋯」菜单点「收藏」，或打开笔记后点顶栏的 ⭐。收藏不会产生新版本。"
            />
          </div>
        ) : null}

        {status === 'ready' && data && data.items.length > 0 ? (
          <ul className="vw-list">
            {data.items.map((note) => (
              <li key={note.id}>
                <div className="vw-row" style={{ cursor: 'default' }}>
                  <button
                    type="button"
                    className="vw-row__main"
                    style={{ border: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', padding: 0 }}
                    onClick={() => ctx.openNote(note.id)}
                  >
                    <span className="vw-row__title">{note.title || `无标题 #${note.id}`}</span>
                    <span className="vw-row__meta">
                      <span className="vw-chip">{folderName(note.folderId)}</span>
                      <span>更新 {ctx.relativeTime(note.updatedAt)}</span>
                      <span>v{note.version}</span>
                      {note.tags.map((tag) => (
                        <span className="vw-chip" key={tag.id}>
                          <span className="vw-dot" style={{ background: tag.color }} />
                          {tag.name}
                        </span>
                      ))}
                    </span>
                    {note.excerpt ? <span className="vw-row__sub">{note.excerpt}</span> : null}
                  </button>
                  <span className="vw-row__act">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busyId === note.id}
                      onClick={() => void unfavorite(note)}
                    >
                      取消收藏
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {status === 'ready' && data && data.total > PAGE_SIZE ? (
        <footer className="vw__foot">
          <span>
            共 {data.total} 条 · 第 {page}/{pageCount} 页
          </span>
          <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              上一页
            </Button>
            <Button size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>
              下一页
            </Button>
          </span>
        </footer>
      ) : null}
    </section>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { describeApiError } from '@/api/client'
import { createNote, getNote, listBacklinks, listLinks } from '@/api/notes'
import type { BacklinkItem, FolderNode, NoteDetail, ResolvedLink } from '@/api/types'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from '@/views/types'

type Status = 'idle' | 'loading' | 'ready' | 'error'

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

export default function BacklinksView({ ctx }: ViewProps) {
  const noteIdParam = ctx.params.note ?? ''
  const noteId = noteIdParam ? Number(noteIdParam) : null

  const [note, setNote] = useState<NoteDetail | null>(null)
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([])
  const [resolved, setResolved] = useState<ResolvedLink[]>([])
  const [dangling, setDangling] = useState<string[]>([])
  const [status, setStatus] = useState<Status>(noteId ? 'loading' : 'idle')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const navigate = ctx.navigate
  const folders = useMemo(() => flattenFolders(ctx.tree), [ctx.tree])

  const folderName = (id: number | null): string => {
    if (id === null) return '未分类'
    return folders.find((folder) => folder.id === id)?.name ?? `目录 #${id}`
  }

  useEffect(() => {
    if (noteId === null || !Number.isFinite(noteId)) {
      setStatus('idle')
      return
    }
    const controller = new AbortController()
    setStatus('loading')
    setError('')

    Promise.all([
      getNote(noteId, controller.signal),
      listBacklinks(noteId, controller.signal),
      listLinks(noteId, controller.signal),
    ])
      .then(([detail, backlinkView, linkView]) => {
        setNote(detail)
        setBacklinks(backlinkView.items)
        setResolved(linkView.resolved)
        // 契约：dangling 是纯字符串数组（API.md §4.1）
        setDangling(linkView.dangling)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return
        setError(describeApiError(err))
        setStatus('error')
      })

    return () => controller.abort()
  }, [noteId, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  const createFromDangling = async (title: string) => {
    if (creating) return
    setCreating(title)
    try {
      const created = await createNote({ title, content: `# ${title}\n\n`, folderId: null })
      ctx.toast.success(`已创建笔记「${title}」`)
      await ctx.refreshNotes()
      await ctx.refreshTree()
      reload()
      ctx.toast.info(`新笔记 #${created.id} 已建立链接`)
    } catch (err: unknown) {
      ctx.toast.error(`创建失败：${describeApiError(err)}`)
    } finally {
      setCreating('')
    }
  }

  const picker = (
    <div className="vw__bar">
      <div className="kb-field" style={{ minWidth: '260px' }}>
        <label className="kb-field__label" htmlFor="vw-backlinks-note">
          选择一篇笔记
        </label>
        <select
          id="vw-backlinks-note"
          className="kb-select"
          value=""
          onChange={(event) => {
            const value = event.target.value
            if (value) navigate('backlinks', { note: value })
          }}
        >
          <option value="">{ctx.notes.length > 0 ? '请选择…' : '笔记列表加载中…'}</option>
          {ctx.notes.map((item) => (
            <option key={item.id} value={String(item.id)}>
              {item.title || `无标题 #${item.id}`}
            </option>
          ))}
        </select>
      </div>
      <span className="vw__count">
        {ctx.notes.length > 0 ? `已载入 ${ctx.notes.length} 篇笔记` : '正在载入笔记列表…'}
      </span>
    </div>
  )

  return (
    <section className="vw" aria-label="反链">
      <header className="vw__head">
        <h1 className="vw__title">反链</h1>
        {status === 'ready' ? (
          <span className="vw__count">
            反链 {backlinks.length} · 出链 {resolved.length + dangling.length}
          </span>
        ) : null}
        <div className="vw__actions">
          <Button size="sm" onClick={reload} disabled={noteId === null}>
            刷新
          </Button>
          {noteId !== null ? (
            <Button size="sm" variant="primary" onClick={() => ctx.openNote(noteId)}>
              打开笔记
            </Button>
          ) : null}
          {noteId !== null ? (
            <Button size="sm" onClick={() => navigate('versions', { note: String(noteId) })}>
              版本历史
            </Button>
          ) : null}
        </div>
      </header>

      {noteId === null ? picker : null}

      {note ? (
        <div className="vw__bar" style={{ paddingTop: 'var(--sp-2)', paddingBottom: 'var(--sp-2)' }}>
          <strong style={{ fontSize: 'var(--fs-md)' }}>{note.title || `无标题 #${note.id}`}</strong>
          <span className="vw__count">
            v{note.version} · 更新 {ctx.relativeTime(note.updatedAt)}
          </span>
        </div>
      ) : null}

      <div className="vw__body">
        {noteId === null ? (
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">🔗</span>}
              title="先选一篇笔记"
              desc="这里展示某篇笔记的反链（谁引用了我）与出链（我引用了谁）。也可以用地址栏 #/backlinks?note=3 直接定位。"
            />
          </div>
        ) : null}

        {status === 'loading' ? (
          <div className="vw-skeleton" aria-busy="true" aria-label="反链加载中">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <Skeleton width="45%" height={16} />
                <Skeleton width="75%" />
              </div>
            ))}
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">⚠️</span>}
              title="反链加载失败"
              desc={error}
              action={
                <Button variant="primary" onClick={reload}>
                  重试
                </Button>
              }
            />
          </div>
        ) : null}

        {status === 'ready' ? (
          <>
            <h2 className="vw-section">
              反向引用
              <span className="kb-badge kb-badge--accent">{backlinks.length}</span>
            </h2>
            {backlinks.length === 0 ? (
              <div className="vw-state">
                <EmptyState
                  icon={<span aria-hidden="true">🪶</span>}
                  title="还没有其它笔记引用它"
                  desc={`在别的笔记正文里写 [[${note?.title || '这篇笔记的标题'}]] 就会建立反链。`}
                />
              </div>
            ) : (
              <ul className="vw-list">
                {backlinks.map((item) => (
                  <li key={item.noteId}>
                    <button type="button" className="vw-row" onClick={() => ctx.openNote(item.noteId)}>
                      <span className="vw-row__main">
                        <span className="vw-row__title">{item.title || `无标题 #${item.noteId}`}</span>
                        <span className="vw-row__sub">{item.excerpt || '（无摘要）'}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <h2 className="vw-section">
              出链
              <span className="kb-badge">{resolved.length} 已创建</span>
              {dangling.length > 0 ? <span className="kb-badge kb-badge--warning">{dangling.length} 未创建</span> : null}
            </h2>
            {resolved.length === 0 && dangling.length === 0 ? (
              <div className="vw-state">
                <EmptyState
                  icon={<span aria-hidden="true">🔗</span>}
                  title="本笔记还没有出链"
                  desc="在正文里写 [[目标标题]] 即可建立链接。"
                />
              </div>
            ) : (
              <ul className="vw-list">
                {resolved.map((item) => (
                  <li key={`r-${item.noteId}`}>
                    <button type="button" className="vw-row" onClick={() => ctx.openNote(item.noteId)}>
                      <span className="vw-row__main">
                        <span className="vw-row__title">{`[[${item.title}]]`}</span>
                        <span className="vw-row__meta">
                          <span className="kb-badge kb-badge--success">已创建</span>
                          <span>#{item.noteId}</span>
                          <span className="vw-chip">{folderName(item.folderId)}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
                {dangling.map((title) => (
                  <li key={`d-${title}`}>
                    <div className="vw-row" style={{ cursor: 'default' }}>
                      <span className="vw-row__main">
                        <span className="vw-row__title">{`[[${title}]]`}</span>
                        <span className="vw-row__meta">
                          <span className="kb-badge kb-badge--warning">未创建</span>
                        </span>
                      </span>
                      <span className="vw-row__act">
                        <Button
                          size="sm"
                          variant="primary"
                          loading={creating === title}
                          onClick={() => void createFromDangling(title)}
                        >
                          创建此笔记
                        </Button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </section>
  )
}

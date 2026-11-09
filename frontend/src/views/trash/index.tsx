/**
 * 回收站视图 —— 路由 `#/trash`（契约 docs/API.md §8.1）
 *
 * 两个区块：笔记 / 目录。目录项的 `noteCount` 语义与目录树不同：
 * 它是「恢复该目录时会一并恢复的笔记数（含子孙）」，因此用 tooltip 明确说明。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { describeApiError, request } from '@/api/client'
import type { EmptyTrashResult, TrashFolderItem, TrashNoteItem, TrashResponse } from '@/api/types'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from '@/views/types'

type Status = 'loading' | 'ready' | 'error'

const NOTE_COUNT_HINT = '恢复该目录时会一并恢复的笔记数（含子目录），与目录树里的 noteCount 口径不同'

export default function TrashView({ ctx }: ViewProps) {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<TrashNoteItem[]>([])
  const [folders, setFolders] = useState<TrashFolderItem[]>([])
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    try {
      const data = await request<TrashResponse>('/api/trash', { signal: controller.signal })
      if (controller.signal.aborted) return
      setNotes(data.notes)
      setFolders(data.folders)
      setStatus('ready')
    } catch (err) {
      if (controller.signal.aborted) return
      setError(describeApiError(err))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      abortRef.current?.abort()
    }
  }, [load])

  /** 恢复 / 彻底删除 / 清空：先落请求，再刷新外壳数据与本地列表 */
  const runAction = useCallback(
    async (key: string, action: () => Promise<void>, onDone: () => void) => {
      if (busyRef.current) return
      busyRef.current = true
      setBusyKey(key)
      try {
        await action()
        await Promise.all([ctx.refreshNotes(), ctx.refreshTree()])
        onDone()
        await load()
      } catch (err) {
        ctx.toast.error(`${describeApiError(err)}`)
      } finally {
        busyRef.current = false
        setBusyKey(null)
      }
    },
    [ctx, load],
  )

  const restoreNote = useCallback(
    (item: TrashNoteItem) => {
      void runAction(
        `note-${item.id}`,
        async () => {
          await request(`/api/trash/notes/${item.id}/restore`, { method: 'POST' })
          ctx.toast.success(`已恢复「${item.title || '（无标题）'}」`)
        },
        () => setNotes((prev) => prev.filter((row) => row.id !== item.id)),
      )
    },
    [ctx, runAction],
  )

  const restoreFolder = useCallback(
    (item: TrashFolderItem) => {
      void runAction(
        `folder-${item.id}`,
        async () => {
          await request(`/api/trash/folders/${item.id}/restore`, { method: 'POST' })
          ctx.toast.success(`已恢复目录「${item.name}」及其内容`)
        },
        () => setFolders((prev) => prev.filter((row) => row.id !== item.id)),
      )
    },
    [ctx, runAction],
  )

  const purgeNote = useCallback(
    async (item: TrashNoteItem) => {
      const ok = await ctx.confirm({
        title: '彻底删除笔记',
        message: `将永久删除「${item.title || '（无标题）'}」。此操作不可恢复，确定继续吗？`,
        confirmText: '永久删除',
        danger: true,
      })
      if (!ok) return
      void runAction(
        `note-${item.id}`,
        async () => {
          await request(`/api/trash/notes/${item.id}`, { method: 'DELETE' })
          ctx.toast.success('已永久删除')
        },
        () => setNotes((prev) => prev.filter((row) => row.id !== item.id)),
      )
    },
    [ctx, runAction],
  )

  const purgeFolder = useCallback(
    async (item: TrashFolderItem) => {
      const ok = await ctx.confirm({
        title: '彻底删除目录',
        message: `将永久删除目录「${item.name}」及其中的全部笔记与子目录（共 ${item.noteCount} 篇笔记）。此操作不可恢复，确定继续吗？`,
        confirmText: '永久删除',
        danger: true,
      })
      if (!ok) return
      void runAction(
        `folder-${item.id}`,
        async () => {
          await request(`/api/trash/folders/${item.id}`, { method: 'DELETE' })
          ctx.toast.success('已永久删除')
        },
        () => setFolders((prev) => prev.filter((row) => row.id !== item.id)),
      )
    },
    [ctx, runAction],
  )

  const emptyTrash = useCallback(async () => {
    const parts: string[] = []
    if (notes.length) parts.push(`${notes.length} 篇笔记`)
    if (folders.length) parts.push(`${folders.length} 个目录（连同其中内容）`)
    const ok = await ctx.confirm({
      title: '清空回收站',
      message: `回收站中的 ${parts.join('、')} 将被永久删除，且不可恢复。确定清空吗？`,
      confirmText: '永久删除全部',
      danger: true,
    })
    if (!ok) return
    void runAction(
      'empty',
      async () => {
        const res = await request<EmptyTrashResult>('/api/trash/empty', { method: 'POST' })
        ctx.toast.success(`已清空回收站（${res.deletedNotes} 篇笔记、${res.deletedFolders} 个目录）`)
      },
      () => {
        setNotes([])
        setFolders([])
      },
    )
  }, [ctx, folders.length, notes.length, runAction])

  const total = notes.length + folders.length

  return (
    <div className="kb-adm kb-adm--trash">
      <header className="kb-adm__head">
        <div className="kb-adm__heading">
          <h1 className="kb-adm__title">回收站</h1>
          <p className="kb-adm__sub">
            {status === 'ready' && total > 0 ? `共 ${total} 项，可随时恢复` : '删除的笔记与目录会先放到这里'}
          </p>
        </div>
        <div className="kb-adm__actions">
          <Button size="sm" onClick={() => void load()} disabled={status === 'loading'}>
            刷新
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => void emptyTrash()}
            disabled={total === 0 || status !== 'ready'}
            loading={busyKey === 'empty'}
          >
            清空回收站
          </Button>
        </div>
      </header>

      <div className="kb-adm__body">
        {status === 'loading' ? (
          <div className="kb-adm__stack" aria-busy="true">
            <div className="kb-adm-card">
              <div className="kb-adm-card__body">
                <Skeleton width="32%" height={14} />
                <Skeleton width="70%" height={12} />
                <Skeleton width="58%" height={12} />
                <Skeleton width="64%" height={12} />
              </div>
            </div>
          </div>
        ) : null}

        {status === 'error' ? (
          <EmptyState
            title="回收站加载失败"
            desc={error}
            action={
              <Button size="sm" onClick={() => void load()}>
                重试
              </Button>
            }
          />
        ) : null}

        {status === 'ready' && total === 0 ? (
          <EmptyState title="回收站是空的" desc="删除的笔记与目录会先放到这里，可随时恢复。" />
        ) : null}

        {status === 'ready' && total > 0 ? (
          <div className="kb-adm__stack">
            {notes.length > 0 ? (
              <section className="kb-adm-card" aria-label="已删除的笔记">
                <div className="kb-adm-card__head">
                  <h2 className="kb-adm-card__title">笔记</h2>
                  <span className="kb-adm-count">{notes.length}</span>
                </div>
                <ul className="kb-adm-list">
                  {notes.map((item) => (
                    <li key={item.id} className={`kb-adm-row${busyKey === `note-${item.id}` ? ' is-busy' : ''}`}>
                      <div className="kb-adm-row__main">
                        <p className="kb-adm-row__title" title={item.title}>
                          {item.title || '（无标题）'}
                        </p>
                        <p className="kb-adm-row__meta">
                          <span>{item.folderName ? `来自「${item.folderName}」` : '未分类'}</span>
                          <span title={ctx.formatDate(item.deletedAt)}>
                            删除于 {ctx.relativeTime(item.deletedAt)}
                          </span>
                        </p>
                      </div>
                      <div className="kb-adm-row__actions">
                        <Button
                          size="sm"
                          onClick={() => restoreNote(item)}
                          disabled={busyKey !== null && busyKey !== `note-${item.id}`}
                        >
                          恢复
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => void purgeNote(item)}
                          disabled={busyKey !== null && busyKey !== `note-${item.id}`}
                        >
                          彻底删除
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {folders.length > 0 ? (
              <section className="kb-adm-card" aria-label="已删除的目录">
                <div className="kb-adm-card__head">
                  <h2 className="kb-adm-card__title">目录</h2>
                  <span className="kb-adm-count">{folders.length}</span>
                </div>
                <ul className="kb-adm-list">
                  {folders.map((item) => (
                    <li key={item.id} className={`kb-adm-row${busyKey === `folder-${item.id}` ? ' is-busy' : ''}`}>
                      <div className="kb-adm-row__main">
                        <p className="kb-adm-row__title" title={item.name}>
                          {item.name || '（未命名目录）'}
                        </p>
                        <p className="kb-adm-row__meta">
                          <span title={NOTE_COUNT_HINT}>含 {item.noteCount} 篇笔记 ⓘ</span>
                          <span title={ctx.formatDate(item.deletedAt)}>
                            删除于 {ctx.relativeTime(item.deletedAt)}
                          </span>
                        </p>
                      </div>
                      <div className="kb-adm-row__actions">
                        <Button
                          size="sm"
                          onClick={() => restoreFolder(item)}
                          disabled={busyKey !== null && busyKey !== `folder-${item.id}`}
                        >
                          恢复
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => void purgeFolder(item)}
                          disabled={busyKey !== null && busyKey !== `folder-${item.id}`}
                        >
                          彻底删除
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

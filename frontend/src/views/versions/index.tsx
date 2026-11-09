import { useCallback, useEffect, useState } from 'react'
import { describeApiError } from '@/api/client'
import { getNote, getVersion, listVersions, restoreVersion } from '@/api/notes'
import type { NoteDetail, VersionSummary } from '@/api/types'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from '@/views/types'

type Status = 'idle' | 'loading' | 'ready' | 'error'

/** LCS 单元格上限：超过就退化成逐行对齐，避免大文档卡死 */
const MAX_DIFF_CELLS = 400_000

interface DiffRow {
  type: 'same' | 'del' | 'add' | 'gap'
  left?: string
  right?: string
  ln?: number
  rn?: number
  count?: number
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** 行级 LCS diff；超大文本退化为逐行对齐 */
function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length
  const rows: DiffRow[] = []

  if (n * m > MAX_DIFF_CELLS) {
    for (let i = 0; i < Math.max(n, m); i += 1) {
      const left = a[i]
      const right = b[i]
      if (left === right) {
        if (left !== undefined) rows.push({ type: 'same', left, right, ln: i + 1, rn: i + 1 })
      } else {
        if (left !== undefined) rows.push({ type: 'del', left, ln: i + 1 })
        if (right !== undefined) rows.push({ type: 'add', right, rn: i + 1 })
      }
    }
    return collapseSame(rows)
  }

  const table: Uint32Array[] = []
  for (let i = 0; i <= n; i += 1) table.push(new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const current = table[i]
      const next = table[i + 1]
      if (!current || !next) continue
      current[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, current[j + 1] ?? 0)
    }
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', left: a[i], right: b[j], ln: i + 1, rn: j + 1 })
      i += 1
      j += 1
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      rows.push({ type: 'del', left: a[i], ln: i + 1 })
      i += 1
    } else {
      rows.push({ type: 'add', right: b[j], rn: j + 1 })
      j += 1
    }
  }
  while (i < n) {
    rows.push({ type: 'del', left: a[i], ln: i + 1 })
    i += 1
  }
  while (j < m) {
    rows.push({ type: 'add', right: b[j], rn: j + 1 })
    j += 1
  }
  return collapseSame(rows)
}

/** 折叠过长的「未改动」段，保留首尾各 keep 行 */
function collapseSame(rows: DiffRow[], keep = 3): DiffRow[] {
  const out: DiffRow[] = []
  let i = 0
  while (i < rows.length) {
    const row = rows[i]
    if (!row || row.type !== 'same') {
      if (row) out.push(row)
      i += 1
      continue
    }
    let j = i
    while (j < rows.length && rows[j]?.type === 'same') j += 1
    const run = j - i
    if (run > keep * 2 + 2) {
      for (let k = i; k < i + keep; k += 1) {
        const item = rows[k]
        if (item) out.push(item)
      }
      out.push({ type: 'gap', count: run - keep * 2 })
      for (let k = j - keep; k < j; k += 1) {
        const item = rows[k]
        if (item) out.push(item)
      }
    } else {
      for (let k = i; k < j; k += 1) {
        const item = rows[k]
        if (item) out.push(item)
      }
    }
    i = j
  }
  return out
}

export default function VersionsView({ ctx }: ViewProps) {
  const noteIdParam = ctx.params.note ?? ''
  const noteId = noteIdParam ? Number(noteIdParam) : null

  const [note, setNote] = useState<NoteDetail | null>(null)
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [selected, setSelected] = useState<VersionSummary | null>(null)
  const [versionContent, setVersionContent] = useState('')
  const [status, setStatus] = useState<Status>(noteId ? 'loading' : 'idle')
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const navigate = ctx.navigate

  useEffect(() => {
    if (noteId === null || !Number.isFinite(noteId)) {
      setStatus('idle')
      return
    }
    const controller = new AbortController()
    setStatus('loading')
    setError('')
    setSelected(null)
    setVersionContent('')

    Promise.all([getNote(noteId, controller.signal), listVersions(noteId, controller.signal)])
      .then(([detail, list]) => {
        setNote(detail)
        // 契约：/versions 是裸数组（API.md §4.4）
        const ordered = [...list].sort((a, b) => b.version - a.version)
        setVersions(ordered)
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

  const selectVersion = async (target: VersionSummary) => {
    if (noteId === null) return
    setSelected(target)
    setVersionContent('')
    setDetailLoading(true)
    try {
      const detail = await getVersion(noteId, target.version)
      setVersionContent(detail.content)
    } catch (err: unknown) {
      if (!isAbort(err)) ctx.toast.error(`读取版本失败：${describeApiError(err)}`)
    } finally {
      setDetailLoading(false)
    }
  }

  const restore = async (target: VersionSummary) => {
    if (noteId === null || restoring) return
    const ok = await ctx.confirm({
      title: '回滚到历史版本',
      message: `将把「${note?.title || '该笔记'}」的内容回滚到 v${target.version}。当前内容会先存为一个新版本，不会丢失；回滚本身也会产生新版本。`,
      confirmText: '回滚',
    })
    if (!ok) return
    setRestoring(true)
    try {
      await restoreVersion(noteId, target.version)
      ctx.toast.success(`已回滚到 v${target.version}`)
      // 回滚改变了正文：先让外壳重载当前笔记（含正文），再刷新列表
      if (typeof ctx.reloadCurrentNote === 'function') await ctx.reloadCurrentNote()
      await ctx.refreshNotes()
      reload()
    } catch (err: unknown) {
      ctx.toast.error(`回滚失败：${describeApiError(err)}`)
    } finally {
      setRestoring(false)
    }
  }

  const rows = selected && !detailLoading && note ? diffLines(versionContent, note.content) : []
  const stats = rows.reduce(
    (acc, row) => {
      if (row.type === 'add') acc.add += 1
      if (row.type === 'del') acc.del += 1
      return acc
    },
    { add: 0, del: 0 },
  )

  const picker = (
    <div className="vw__bar">
      <div className="kb-field" style={{ minWidth: '260px' }}>
        <label className="kb-field__label" htmlFor="vw-versions-note">
          选择一篇笔记
        </label>
        <select
          id="vw-versions-note"
          className="kb-select"
          value=""
          onChange={(event) => {
            const value = event.target.value
            if (value) navigate('versions', { note: value })
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
      <span className="vw__count">{ctx.notes.length > 0 ? `已载入 ${ctx.notes.length} 篇笔记` : ''}</span>
    </div>
  )

  return (
    <section className="vw" aria-label="历史版本">
      <header className="vw__head">
        <h1 className="vw__title">历史版本</h1>
        {status === 'ready' ? <span className="vw__count">{versions.length} 个版本</span> : null}
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
            <Button size="sm" onClick={() => navigate('backlinks', { note: String(noteId) })}>
              反链
            </Button>
          ) : null}
        </div>
      </header>

      {noteId === null ? picker : null}

      {note ? (
        <div className="vw__bar" style={{ paddingTop: 'var(--sp-2)', paddingBottom: 'var(--sp-2)' }}>
          <strong style={{ fontSize: 'var(--fs-md)' }}>{note.title || `无标题 #${note.id}`}</strong>
          <span className="kb-badge kb-badge--accent">当前 v{note.version}</span>
          <span className="vw__count">更新 {ctx.relativeTime(note.updatedAt)}</span>
        </div>
      ) : null}

      {noteId === null ? (
        <div className="vw__body">
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">🕰️</span>}
              title="先选一篇笔记"
              desc="这里展示某篇笔记的历史版本并支持回滚；也可以用地址栏 #/versions?note=1 直接定位。"
            />
          </div>
        </div>
      ) : null}

      {status === 'loading' ? (
        <div className="vw-skeleton" aria-busy="true" aria-label="版本加载中">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} width="60%" height={18} />
          ))}
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="vw__body">
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">⚠️</span>}
              title="版本加载失败"
              desc={error}
              action={
                <Button variant="primary" onClick={reload}>
                  重试
                </Button>
              }
            />
          </div>
        </div>
      ) : null}

      {status === 'ready' ? (
        versions.length === 0 ? (
          <div className="vw__body">
            <div className="vw-state">
              <EmptyState
                icon={<span aria-hidden="true">🕰️</span>}
                title="暂无历史版本"
                desc="保存正文或标题后才会产生版本；收藏、置顶、移动目录不产生版本。"
              />
            </div>
          </div>
        ) : (
          <div className="vw-split">
            <div className="vw-split__aside">
              <ul className="vw-verlist">
                {versions.map((item) => (
                  <li key={item.version}>
                    <button
                      type="button"
                      className={`vw-ver${selected?.version === item.version ? ' vw-ver--active' : ''}`}
                      onClick={() => void selectVersion(item)}
                    >
                      <span className="vw-ver__row">
                        <strong>v{item.version}</strong>
                        {item.version === note?.version ? <span className="kb-badge kb-badge--accent">当前</span> : null}
                        <span className="vw__grow" />
                        <span className="vw__count">{item.size} 字</span>
                      </span>
                      <span className="vw-ver__time">{ctx.formatDate(item.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="vw-split__main">
              <div className="vw__bar" style={{ paddingTop: 'var(--sp-2)', paddingBottom: 'var(--sp-2)' }}>
                {selected ? (
                  <>
                    <strong>v{selected.version}</strong>
                    <span className="vw__count">{ctx.formatDate(selected.createdAt)}</span>
                    <span className="vw__count">{selected.size} 字</span>
                    <span className="kb-badge">{`+${stats.add}`}</span>
                    <span className="kb-badge kb-badge--danger">{`−${stats.del}`}</span>
                    <span className="vw__grow" />
                    <Button
                      size="sm"
                      variant="primary"
                      loading={restoring}
                      onClick={() => void restore(selected)}
                    >
                      回滚到此版本
                    </Button>
                  </>
                ) : (
                  <span className="vw__count">从左侧选择一个版本查看与当前内容的差异</span>
                )}
              </div>

              {detailLoading ? (
                <div className="vw-skeleton">
                  <Skeleton width="70%" />
                  <Skeleton width="90%" />
                  <Skeleton width="50%" />
                </div>
              ) : null}

              {!detailLoading && selected && note ? (
                <>
                  <div className="vw-diffhead">
                    <span>{`该版本 v${selected.version}`}</span>
                    <span>{`当前 v${note.version}`}</span>
                  </div>
                  <div className="vw-diff">
                    {rows.map((row, index) =>
                      row.type === 'gap' ? (
                        <div className="vw-diff__row" key={`gap-${index}`}>
                          <div className="vw-diff__gap">{`⋯ 折叠 ${row.count ?? 0} 行未改动`}</div>
                        </div>
                      ) : (
                        <div className="vw-diff__row" key={`row-${index}`}>
                          <div className="vw-diff__no">{row.ln ?? ''}</div>
                          <div
                            className={`vw-diff__cell${
                              row.type === 'del' ? ' vw-diff__cell--del' : row.left === undefined ? ' vw-diff__cell--void' : ''
                            }`}
                          >
                            {row.left ?? ''}
                          </div>
                          <div className="vw-diff__no">{row.rn ?? ''}</div>
                          <div
                            className={`vw-diff__cell${
                              row.type === 'add' ? ' vw-diff__cell--add' : row.right === undefined ? ' vw-diff__cell--void' : ''
                            }`}
                          >
                            {row.right ?? ''}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </>
              ) : null}

              {!detailLoading && selected && rows.length === 0 && note ? (
                <div className="vw-state">
                  <EmptyState
                    icon={<span aria-hidden="true">✅</span>}
                    title="与当前版本完全一致"
                    desc="这个版本的内容与当前笔记逐行相同。"
                  />
                </div>
              ) : null}
            </div>
          </div>
        )
      ) : null}
    </section>
  )
}

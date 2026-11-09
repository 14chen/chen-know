import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, describeApiError, request } from '@/api/client'
import type { Tag } from '@/api/types'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Modal } from '@/components/Modal'
import { Skeleton } from '@/components/Skeleton'
import { TextField } from '@/components/TextField'
import type { ViewProps } from '@/views/types'

type Status = 'loading' | 'ready' | 'error'

interface Draft {
  mode: 'create' | 'edit'
  id: number | null
  name: string
  color: string
}

const DEFAULT_COLOR = '#4f46e5'

/** 预设色板：与编辑器格式工具栏的调色板保持一致（固定 7 色） */
const TAG_PALETTE = [
  { value: '#4f46e5', name: '靛蓝' },
  { value: '#e11d48', name: '玫红' },
  { value: '#ea580c', name: '橙' },
  { value: '#16a34a', name: '绿' },
  { value: '#0ea5e9', name: '天蓝' },
  { value: '#7c3aed', name: '紫' },
  { value: '#64748b', name: '灰蓝' },
] as const

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function normalizeColor(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_COLOR
}

export default function TagsView({ ctx }: ViewProps) {
  const [tags, setTags] = useState<Tag[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useState<'count' | 'name'>('count')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    request<Tag[]>('/api/tags', { signal: controller.signal })
      .then((list) => {
        // GET /api/tags 是裸数组（API.md §4.3）
        setTags(Array.isArray(list) ? list : [])
        setStatus('ready')
        setError('')
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return
        setError(describeApiError(err))
        setStatus('error')
      })
    return () => controller.abort()
  }, [reloadKey])

  const visible = useMemo(() => {
    const keyword = filter.trim().toLowerCase()
    const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name, 'zh-Hans-CN')
    return tags
      .filter((tag) => !keyword || tag.name.toLowerCase().includes(keyword))
      .sort((a, b) => (sortBy === 'name' ? byName(a, b) : b.count - a.count || byName(a, b)))
  }, [tags, filter, sortBy])

  // 预设色板 + 兜底：历史标签的颜色不在预设里时，补一块「当前」色块，保证选中态可见
  const swatches = useMemo(() => {
    const current = draft ? normalizeColor(draft.color) : DEFAULT_COLOR
    const palette: Array<{ value: string; name: string }> = TAG_PALETTE.map((item) => ({
      value: item.value,
      name: item.name,
    }))
    if (palette.some((item) => item.value === current)) return palette
    return [...palette, { value: current, name: '当前' }]
  }, [draft])

  const openCreate = () => setDraft({ mode: 'create', id: null, name: '', color: DEFAULT_COLOR })

  const openEdit = (tag: Tag) =>
    setDraft({ mode: 'edit', id: tag.id, name: tag.name, color: normalizeColor(tag.color) })

  const save = async () => {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) {
      ctx.toast.warn('标签名不能为空')
      return
    }
    setSaving(true)
    try {
      if (draft.mode === 'create') {
        await request<Tag>('/api/tags', { method: 'POST', body: { name, color: draft.color } })
        ctx.toast.success(`已创建标签「${name}」`)
      } else {
        await request<Tag>(`/api/tags/${draft.id}`, {
          method: 'PATCH',
          body: { name, color: draft.color },
        })
        ctx.toast.success('标签已更新')
      }
      setDraft(null)
      reload()
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'CONFLICT') ctx.toast.error(`标签「${name}」已存在`)
      else ctx.toast.error(`保存失败：${describeApiError(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (tag: Tag) => {
    const ok = await ctx.confirm({
      title: '删除标签',
      message:
        tag.count > 0
          ? `将删除标签「${tag.name}」，并解除它与 ${tag.count} 篇笔记的关联（笔记本身不会被删除）。此操作不可撤销。`
          : `将删除标签「${tag.name}」。此操作不可撤销。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await request<void>(`/api/tags/${tag.id}`, { method: 'DELETE' })
      ctx.toast.success('标签已删除')
      reload()
    } catch (err: unknown) {
      ctx.toast.error(`删除失败：${describeApiError(err)}`)
    }
  }

  return (
    <section className="vw" aria-label="标签">
      <header className="vw__head">
        <h1 className="vw__title">标签</h1>
        {status === 'ready' ? (
          <span className="vw__count">
            {filter ? `${visible.length}/${tags.length} 个标签` : `${tags.length} 个标签`}
          </span>
        ) : null}
        <div className="vw__actions">
          <Button size="sm" variant="primary" onClick={openCreate}>
            新建标签
          </Button>
          <Button size="sm" onClick={reload}>
            刷新
          </Button>
        </div>
      </header>

      <div className="vw__bar">
        <TextField
          label="筛选"
          type="search"
          value={filter}
          placeholder="按名称筛选…"
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="kb-field">
          <label className="kb-field__label" htmlFor="vw-tags-sort">
            排序
          </label>
          <select
            id="vw-tags-sort"
            className="kb-select"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value === 'name' ? 'name' : 'count')}
          >
            <option value="count">笔记数 ↓</option>
            <option value="name">名称 A-Z</option>
          </select>
        </div>
      </div>

      <div className="vw__body">
        {status === 'loading' ? (
          <div className="vw-skeleton" aria-busy="true" aria-label="标签加载中">
            <div className="vw-grid">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <Skeleton key={index} height={48} />
              ))}
            </div>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">⚠️</span>}
              title="标签加载失败"
              desc={error}
              action={
                <Button variant="primary" onClick={reload}>
                  重试
                </Button>
              }
            />
          </div>
        ) : null}

        {status === 'ready' && tags.length === 0 ? (
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">🏷️</span>}
              title="还没有标签"
              desc="可以在这里新建，也可以在笔记里给笔记打标签；不存在的标签会自动创建。"
              action={
                <Button variant="primary" onClick={openCreate}>
                  新建标签
                </Button>
              }
            />
          </div>
        ) : null}

        {status === 'ready' && tags.length > 0 && visible.length === 0 ? (
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">🔍</span>}
              title="没有匹配的标签"
              desc={`没有名称包含「${filter.trim()}」的标签。`}
              action={<Button onClick={() => setFilter('')}>清空筛选</Button>}
            />
          </div>
        ) : null}

        {status === 'ready' && visible.length > 0 ? (
          <ul className="vw-grid">
            {visible.map((tag) => (
              <li key={tag.id}>
                <div className="vw-card">
                  <button
                    type="button"
                    className="vw-card__main"
                    title={`用「${tag.name}」筛选笔记`}
                    onClick={() => ctx.navigate('search', { tag: tag.name })}
                  >
                    <span className="vw-dot" style={{ background: normalizeColor(tag.color) }} />
                    <span className="vw-card__name">{tag.name}</span>
                    <span className="vw-card__count">{tag.count} 篇</span>
                  </button>
                  <span className="vw-card__act">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(tag)} aria-label={`编辑标签 ${tag.name}`}>
                      编辑
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(tag)} aria-label={`删除标签 ${tag.name}`}>
                      删除
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <Modal
        open={draft !== null}
        title={draft?.mode === 'edit' ? '编辑标签' : '新建标签'}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button onClick={() => setDraft(null)} disabled={saving}>
              取消
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {draft?.mode === 'edit' ? '保存' : '创建'}
            </Button>
          </>
        }
      >
        {draft ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            <TextField
              label="标签名"
              value={draft.name}
              autoFocus
              placeholder="例如：Java"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save()
              }}
            />
            <div className="kb-field">
              <span className="kb-field__label" id="vw-tag-color-label">
                颜色
              </span>
              <div className="vw-swatches" role="radiogroup" aria-labelledby="vw-tag-color-label">
                {swatches.map((item) => {
                  const selected = normalizeColor(draft.color) === item.value
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`颜色 ${item.value}`}
                      title={`${item.name} ${item.value}`}
                      className={`vw-swatch${selected ? ' vw-swatch--active' : ''}`}
                      style={{ background: item.value }}
                      onClick={() => setDraft({ ...draft, color: item.value })}
                    >
                      {selected ? (
                        <span className="vw-swatch__check" aria-hidden="true">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
              <span className="kb-field__hint">当前色值 {normalizeColor(draft.color)}</span>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  )
}

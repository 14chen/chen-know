import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { describeApiError, request } from '@/api/client'
import { searchNotes, searchSuggest } from '@/api/notes'
import type { SearchHitWithSnippet, SearchSuggestion } from '@/api/notes'
import type { FolderNode, Tag } from '@/api/types'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Select } from '@/components/Select'
import { Skeleton } from '@/components/Skeleton'
import { TextField } from '@/components/TextField'
import type { ViewProps } from '@/views/types'
import '@/styles/views-search.css'

const PAGE_SIZE = 20
/** 输入停止 250ms 后才发查询（只影响请求，不影响输入框受控值） */
const DEBOUNCE_MS = 250
/** 联想词请求也稍作防抖，避免每键一次 */
const SUGGEST_DEBOUNCE_MS = 200
const HISTORY_KEY = 'kb.search.history'
const HISTORY_MAX = 8

function readHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, HISTORY_MAX)
  } catch {
    return []
  }
}

function writeHistory(items: string[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items))
  } catch {
    /* 隐私模式/配额满：历史只是锦上添花，写不进去就算了 */
  }
}

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface FlatFolder {
  id: number
  name: string
  depth: number
}

const SORT_OPTIONS = [
  { value: 'relevance', label: '按相关度' },
  { value: 'updated', label: '按最近更新' },
]

function flattenFolders(nodes: FolderNode[], depth = 0, out: FlatFolder[] = []): FlatFolder[] {
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, depth })
    if (node.children.length > 0) flattenFolders(node.children, depth + 1, out)
  }
  return out
}

function folderLabel(folders: FlatFolder[], id: number | null): string {
  if (id === null) return '未分类'
  const hit = folders.find((folder) => folder.id === id)
  return hit ? hit.name : `目录 #${id}`
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

const HIGHLIGHT_TAGS = new Set(['em', 'mark', 'b', 'strong', 'i'])

/**
 * 把服务端高亮（含 `<em>`）转成 **React 节点** —— 全程不产生 innerHTML。
 *
 * 为什么不是「净化 HTML 字符串」：服务端会把用户写的 `<img onerror=…>` 转义成 `&lt;img …&gt;`，
 * 而 DOMParser 解析时会把实体**解码成文本**；只要再把这棵树的文本拼回 `innerHTML`，
 * 文本就会重新变成真标签 —— 这是「解析 → 再序列化回 innerHTML」这对逆向操作本身的不可靠，
 * 不是「转义漏了一处」。所以这里直接产出 React 元素：
 *  · 只认白名单标签（em / mark / b / strong / i），转成对应 React 元素，**不带任何属性**；
 *  · 其余标签一律丢弃，但**保留其文本子节点**（否则攻击载荷里的文字会凭空消失，用户看不出被过滤）；
 *  · 文本节点直接作为 React 文本子节点 —— 由 React 自动转义，不存在手工拼字符串。
 */
function highlightToNodes(raw: string): ReactNode[] {
  const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, 'text/html')
  const body = doc.body
  const out: ReactNode[] = []
  let key = 0

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.nodeValue ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    const tag = element.tagName.toLowerCase()
    const children: ReactNode[] = []
    element.childNodes.forEach((child) => {
      const before = out.length
      walk(child)
      if (out.length > before) {
        children.push(...out.splice(before, out.length - before))
      }
    })
    if (HIGHLIGHT_TAGS.has(tag)) {
      const mapped = tag === 'i' ? 'em' : tag === 'mark' ? 'mark' : tag === 'b' || tag === 'strong' ? 'strong' : 'em'
      out.push(createElement(mapped, { key: `h${key++}` }, ...children))
      return
    }
    // 不认识的标签：保留文字、丢掉标签外壳
    out.push(...children)
  }

  body.childNodes.forEach(walk)
  return out
}

/**
 * 渲染服务端的 `snippet`：**纯文本 + markdown 粗体**。
 * 只按 `**` 成对切分，命中处用 <strong>，其余原样作文本 —— 不解析任何 HTML，两端 `…` 原样保留。
 */
export function snippetToNodes(snippet: string): ReactNode[] {
  const parts = snippet.split('**')
  return parts.map((part, index) =>
    index % 2 === 1
      ? createElement('strong', { key: `s${index}` }, part)
      : createElement('span', { key: `t${index}` }, part),
  )
}

export default function SearchView({ ctx }: ViewProps) {
  const params = ctx.params
  const urlQ = params.q ?? ''
  const urlFolder = params.folderId ?? ''
  const urlTagId = params.tagId ?? ''
  const urlFrom = params.from ?? ''
  const urlTo = params.to ?? ''
  const urlSort = params.sort === 'updated' ? 'updated' : 'relevance'

  const [draft, setDraft] = useState(urlQ)
  const [status, setStatus] = useState<Status>('idle')
  const [data, setData] = useState<{ items: SearchHitWithSnippet[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [tags, setTags] = useState<Tag[]>([])
  const [folders, setFolders] = useState<FlatFolder[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [focused, setFocused] = useState(false)
  const [composing, setComposing] = useState(false)
  const [suggest, setSuggest] = useState<SearchSuggestion[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [history, setHistory] = useState<string[]>(() => readHistory())
  const [highlight, setHighlight] = useState(-1)
  const [unfilteredTotal, setUnfilteredTotal] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)

  const active = Boolean(urlQ || urlFolder !== '' || urlTagId !== '' || urlFrom || urlTo)
  const filtered = Boolean(urlFolder !== '' || urlTagId !== '' || urlFrom || urlTo)
  const filterCount = [urlFolder !== '', urlTagId !== '', Boolean(urlFrom), Boolean(urlTo)].filter(Boolean).length

  const navigate = ctx.navigate

  // 目录树
  useEffect(() => {
    const controller = new AbortController()
    request<FolderNode[]>('/api/folders?tree=true', { signal: controller.signal })
      .then((tree) => setFolders(flattenFolders(Array.isArray(tree) ? tree : [])))
      .catch(() => setFolders([]))
    return () => controller.abort()
  }, [])

  // 输入防抖后同步到 URL
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = draft.trim()
      if (next === urlQ) return
      navigate('search', {
        q: next || undefined,
        folderId: urlFolder || undefined,
        tagId: urlTagId || undefined,
        from: urlFrom || undefined,
        to: urlTo || undefined,
        sort: urlSort === 'updated' ? 'updated' : undefined,
      })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, urlQ, urlFolder, urlTagId, urlFrom, urlTo, urlSort, navigate])

  // 反向同步（浏览器前进/后退、外部跳转）
  useEffect(() => {
    setDraft((prev) => (prev === urlQ ? prev : urlQ))
  }, [urlQ])

  // 条件变化时回到第一页
  useEffect(() => {
    setPage(1)
  }, [urlQ, urlFolder, urlTagId, urlFrom, urlTo, urlSort])

  // 标签选项
  useEffect(() => {
    const controller = new AbortController()
    request<Tag[]>('/api/tags', { signal: controller.signal })
      .then((list) => setTags(Array.isArray(list) ? list : []))
      .catch(() => setTags([]))
    return () => controller.abort()
  }, [])

  /** 只记录**真正发出去的**搜索（防抖后/回车/点历史都算），去重、最新在前、最多 8 条 */
  const recordHistory = useCallback((keyword: string) => {
    const value = keyword.trim()
    if (!value) return
    setHistory((current) => {
      const next = [value, ...current.filter((item) => item !== value)].slice(0, HISTORY_MAX)
      writeHistory(next)
      return next
    })
  }, [])

  const removeHistory = useCallback((keyword: string) => {
    setHistory((current) => {
      const next = current.filter((item) => item !== keyword)
      writeHistory(next)
      return next
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    writeHistory([])
  }, [])

  // 联想词：聚焦 + 有内容 + 与已执行关键词不同 + 不在输入法组合中
  useEffect(() => {
    if (!focused || composing) {
      setSuggestOpen(false)
      return
    }
    const keyword = draft.trim()
    if (!keyword) {
      setSuggestOpen(false)
      return
    }
    // 已经搜过这个词就不再请求（按规格：与已执行关键词不同才请求）；
    // 但**不关掉已经打开的浮层** —— 否则搜索一执行浮层就闪一下没了，等于没做。
    if (keyword === urlQ) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      searchSuggest(keyword, { limit: 5, signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return
          setSuggest(result.items)
          setHighlight(-1)
          setSuggestOpen(result.items.length > 0)
        })
        .catch(() => {
          /* 联想失败静默：不打断搜索 */
        })
    }, SUGGEST_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [draft, focused, composing, urlQ])

  // 点击页面其它位置：收起两个浮层
  useEffect(() => {
    if (!focused) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current) return
      const target = event.target
      if (target instanceof Node && rootRef.current.contains(target)) return
      setSuggestOpen(false)
      setFocused(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [focused])

  const historyOpen = focused && draft.trim() === '' && history.length > 0
  const popoverOpen = suggestOpen || historyOpen
  const options = suggestOpen ? suggest.map((item) => item.text) : history

  /** 选中联想词 / 历史词：填入输入框并**立即**搜索 */
  const applyKeyword = useCallback(
    (keyword: string) => {
      setDraft(keyword)
      setSuggestOpen(false)
      setHighlight(-1)
      recordHistory(keyword)
      navigate('search', {
        q: keyword,
        folderId: urlFolder || undefined,
        tagId: urlTagId || undefined,
        from: urlFrom || undefined,
        to: urlTo || undefined,
        sort: urlSort === 'updated' ? 'updated' : undefined,
      })
    },
    [navigate, recordHistory, urlFolder, urlTagId, urlFrom, urlTo, urlSort],
  )

  // 查询
  useEffect(() => {
    if (!active) {
      setStatus('idle')
      setData(null)
      setError('')
      return
    }
    const controller = new AbortController()
    setStatus('loading')
    setError('')
    setUnfilteredTotal(null)
    if (urlQ.trim()) recordHistory(urlQ)

    searchNotes({
      q: urlQ,
      tagId: urlTagId === '' ? undefined : Number(urlTagId),
      folderId: urlFolder === '' ? undefined : Number(urlFolder),
      from: urlFrom || undefined,
      to: urlTo || undefined,
      sort: urlSort,
      page,
      size: PAGE_SIZE,
      signal: controller.signal,
    })
      .then((result) => {
        setData({ items: result.items, total: result.total })
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return
        setError(describeApiError(err))
        setStatus('error')
      })

    return () => controller.abort()
  }, [active, urlQ, urlTagId, urlFolder, urlFrom, urlTo, urlSort, page, reloadKey, recordHistory])

  /**
   * 空结果时区分「真没搜到」和「被筛选挡住」：
   * 有任一筛选且 total===0 → 静默再发一次**不带筛选**的请求，能搜到就把条数告诉用户。
   */
  useEffect(() => {
    if (status !== 'ready' || !data || data.total > 0 || !filtered) {
      setUnfilteredTotal(null)
      return
    }
    const controller = new AbortController()
    searchNotes({ q: urlQ, size: 1, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setUnfilteredTotal(result.total)
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnfilteredTotal(null)
      })
    return () => controller.abort()
  }, [status, data, filtered, urlQ])

  const retry = () => setReloadKey((key) => key + 1)

  const navWith = (patch: Record<string, string | undefined>) => {
    navigate('search', {
      q: urlQ || undefined,
      folderId: urlFolder || undefined,
      tagId: urlTagId || undefined,
      from: urlFrom || undefined,
      to: urlTo || undefined,
      sort: urlSort === 'updated' ? 'updated' : undefined,
      ...patch,
    })
  }

  const clearFilters = () => navWith({ folderId: undefined, tagId: undefined, from: undefined, to: undefined, sort: undefined })

  const clearAll = () => {
    setDraft('')
    navigate('search', {})
  }

  const flush = () => navWith({ q: draft.trim() || undefined })

  const pageCount = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  /** 当前生效的筛选条件，逐条文字化（空结果 B 要用） */
  const activeFilters = useMemo(() => {
    const list: string[] = []
    if (urlFolder !== '') list.push('目录：' + folderLabel(folders, Number(urlFolder)))
    if (urlTagId !== '') {
      const tag = tags.find((item) => String(item.id) === urlTagId)
      list.push('标签：' + (tag ? tag.name : '#' + urlTagId))
    }
    if (urlFrom || urlTo) list.push('时间：' + (urlFrom || '…') + ' ~ ' + (urlTo || '…'))
    return list
  }, [urlFolder, urlTagId, urlFrom, urlTo, folders, tags])

  const folderOptions = useMemo(
    () => [
      { value: '', label: '全部目录' },
      { value: '0', label: '未分类' },
      ...folders.map((folder) => ({
        value: String(folder.id),
        label: `${'\u3000'.repeat(folder.depth)}${folder.name}`,
      })),
    ],
    [folders],
  )

  return (
    <section className="vw" aria-label="搜索" ref={rootRef}>
      <header className="vw__head">
        <h1 className="vw__title">搜索</h1>
        {status === 'ready' && data ? (
          <span className="vw__count">
            共 {data.total} 条{filtered ? <span className="vw-search-flag">· 已筛选</span> : null}
          </span>
        ) : null}
        <div className="vw__actions">
          {filtered ? (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              清空筛选（{filterCount}）
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={clearAll} disabled={!active && !draft}>
            重置
          </Button>
        </div>
      </header>

      <div className="vw__bar">
        <div className="vw-search-field" ref={undefined}>
          <TextField
            ref={inputRef}
            label="关键词"
            type="search"
            value={draft}
            placeholder="搜索标题与正文（中文按字匹配）…"
            autoComplete="off"
            role="combobox"
            aria-expanded={popoverOpen}
            aria-controls="kb-search-popover"
            aria-autocomplete="list"
            aria-activedescendant={
              popoverOpen && highlight >= 0 ? `kb-search-option-${highlight}` : undefined
            }
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              // 点浮层里的项时不收起（pointerdown 已处理外部点击）
              window.setTimeout(() => setFocused(false), 120)
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Escape') {
                if (popoverOpen) {
                  event.preventDefault()
                  event.stopPropagation()
                  setSuggestOpen(false)
                  setHighlight(-1)
                  setFocused(false)
                  inputRef.current?.focus()
                }
                return
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (!popoverOpen || options.length === 0) return
                event.preventDefault()
                setHighlight((current) => {
                  const delta = event.key === 'ArrowDown' ? 1 : -1
                  const next = current + delta
                  if (next < 0) return options.length - 1
                  if (next >= options.length) return 0
                  return next
                })
                return
              }
              if (event.key === 'Enter') {
                if (popoverOpen && highlight >= 0 && options[highlight]) {
                  event.preventDefault()
                  applyKeyword(options[highlight])
                  return
                }
                flush()
              }
            }}
          />
          {popoverOpen ? (
            <div className="vw-search-pop" id="kb-search-popover" role="listbox">
              {suggestOpen ? (
                <ul className="vw-search-pop__list">
                  {suggest.map((item, index) => (
                    <li key={item.kind + item.text}>
                      <button
                        type="button"
                        id={`kb-search-option-${index}`}
                        role="option"
                        aria-selected={highlight === index}
                        className={
                          'vw-search-pop__item' + (highlight === index ? ' is-active' : '')
                        }
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => applyKeyword(item.text)}
                      >
                        <span className="vw-search-pop__icon" aria-hidden="true">
                          {item.kind === 'tag' ? '🏷' : '📄'}
                        </span>
                        <span className="vw-search-pop__text">{item.text}</span>
                        <span className="vw-search-pop__kind">
                          {item.kind === 'tag' ? '标签' : '标题'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <div className="vw-search-pop__head">
                    <span>最近搜索</span>
                    <button type="button" className="vw-search-pop__clear" onClick={clearHistory}>
                      清空历史
                    </button>
                  </div>
                  <ul className="vw-search-pop__list">
                    {history.map((keyword, index) => (
                      <li key={keyword} className="vw-search-pop__row">
                        <button
                          type="button"
                          id={`kb-search-option-${index}`}
                          role="option"
                          aria-selected={highlight === index}
                          className={
                            'vw-search-pop__item' + (highlight === index ? ' is-active' : '')
                          }
                          onMouseEnter={() => setHighlight(index)}
                          onClick={() => applyKeyword(keyword)}
                        >
                          <span className="vw-search-pop__icon" aria-hidden="true">
                            🕘
                          </span>
                          <span className="vw-search-pop__text">{keyword}</span>
                        </button>
                        <button
                          type="button"
                          className="vw-search-pop__x"
                          aria-label={`删除历史「${keyword}」`}
                          onClick={() => removeHistory(keyword)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}
        </div>
        <Select
          label="目录（含子目录）"
          value={urlFolder}
          onChange={(event) => navWith({ folderId: event.target.value || undefined })}
          options={folderOptions}
        />
        <Select
          label="标签"
          value={urlTagId}
          onChange={(event) => navWith({ tagId: event.target.value || undefined })}
          options={[
            { value: '', label: '全部标签' },
            ...tags.map((tag) => ({ value: String(tag.id), label: `${tag.name}（${tag.count}）` })),
          ]}
        />
        <Select
          label="排序"
          value={urlSort}
          onChange={(event) => navWith({ sort: event.target.value === 'updated' ? 'updated' : undefined })}
          options={SORT_OPTIONS}
        />
        <div className="vw-search-dates">
          <TextField
            label="起始日期"
            type="date"
            value={urlFrom}
            onChange={(event) => navWith({ from: event.target.value || undefined })}
          />
          <TextField
            label="结束日期"
            type="date"
            value={urlTo}
            onChange={(event) => navWith({ to: event.target.value || undefined })}
          />
        </div>
      </div>

      <div className="vw__body">
        {status === 'idle' ? (
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">🔍</span>}
              title="输入关键词开始搜索"
              desc="支持中文按字匹配（「天气」能命中「今天天气很好」）；也可以只按目录 / 标签 / 日期筛选，无需关键词。"
            />
          </div>
        ) : null}

        {status === 'loading' ? (
          <div className="vw-skeleton" aria-busy="true" aria-label="搜索中">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <Skeleton width="40%" height={16} />
                <Skeleton width="80%" />
              </div>
            ))}
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="vw-state">
            <EmptyState
              icon={<span aria-hidden="true">⚠️</span>}
              title="搜索失败"
              desc={error}
              action={
                <Button variant="primary" onClick={retry}>
                  重试
                </Button>
              }
            />
          </div>
        ) : null}

        {status === 'ready' && data && data.items.length === 0 ? (
          <div className="vw-state">
            {filtered ? (
              /* B：被筛选条件挡住了 */
              <EmptyState
                icon={<span aria-hidden="true">🧹</span>}
                title={`有 ${filterCount} 个条件正在生效，可能挡掉了结果`}
                desc={
                  <span className="vw-search-blocked">
                    <span className="vw-search-blocked__list">
                      {activeFilters.map((item) => (
                        <span key={item} className="vw-chip">
                          {item}
                        </span>
                      ))}
                    </span>
                    {unfilteredTotal !== null && unfilteredTotal > 0 ? (
                      <strong className="vw-search-blocked__hint">
                        去掉筛选后能找到 {unfilteredTotal} 条
                      </strong>
                    ) : (
                      <span>把目录 / 标签 / 日期放宽一点再试。</span>
                    )}
                  </span>
                }
                action={
                  <span style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    <Button variant="primary" onClick={clearFilters}>
                      清除筛选
                    </Button>
                    <Button onClick={clearAll}>换个关键词</Button>
                  </span>
                }
              />
            ) : (
              /* A：真没搜到 */
              <EmptyState
                icon={<span aria-hidden="true">🫙</span>}
                title={urlQ ? `没有找到和「${urlQ}」相关的笔记` : '没有找到匹配的笔记'}
                desc="换个说法试试，或只搜 1–2 个字。"
                action={
                  <Button variant="primary" onClick={clearAll}>
                    换个关键词
                  </Button>
                }
              />
            )}
          </div>
        ) : null}

        {status === 'ready' && data && data.items.length > 0 ? (
          <ul className="vw-list">
            {data.items.map((hit) => (
              <li key={hit.noteId}>
                <button type="button" className="vw-row" onClick={() => ctx.openNote(hit.noteId)}>
                  <span className="vw-row__main">
                    <span className="vw-row__title vw-em">{highlightToNodes(hit.title)}</span>
                    <span className="vw-row__meta">
                      {hit.folderId !== null && hit.folderId !== undefined ? (
                        <span className="vw-chip">{folderLabel(folders, hit.folderId)}</span>
                      ) : null}
                      <span>更新 {ctx.relativeTime(hit.updatedAt)}</span>
                      {urlSort === 'relevance' && Number.isFinite(hit.score) ? (
                        <span>相关度 {hit.score.toFixed(2)}</span>
                      ) : null}
                    </span>
                    {hit.snippet ? (
                      <span className="vw-row__sub vw-search-snippet">{snippetToNodes(hit.snippet)}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {status === 'ready' && data && data.total > 0 ? (
        <footer className="vw__foot">
          <span>
            共 {data.total} 条 · 第 {page}/{pageCount} 页
          </span>
          <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              上一页
            </Button>
            <Button
              size="sm"
              disabled={page >= pageCount}
              onClick={() => setPage((current) => current + 1)}
            >
              下一页
            </Button>
          </span>
        </footer>
      ) : null}
    </section>
  )
}
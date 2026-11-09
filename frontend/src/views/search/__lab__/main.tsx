/**
 * 视图 lab —— **仅用于开发期验收**，不属于应用运行时（registry 的 glob 是 `./* /*.tsx`，
 * 只匹配一层，本文件在两层子目录里，绝不会被注册表选中，也不会进生产 bundle）。
 *
 * 为什么需要它：外壳（f-shell）的 registry 已完成，但 AppShell 还没接入视图渲染。
 * 本文件用**与外壳一致的 ViewContext 语义**（真后端 + 真路由参数）挂载这 6 个视图，
 * 供 `tools/verify/frontend-core/react-views-acceptance.mjs` 做浏览器验收。
 *
 * 用法（dev server）：http://localhost:5173/proto/src/views/search/__lab__/index.html#/search?q=天气
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ComponentType } from 'react'
import { request } from '@/api/client'
import { listNotes } from '@/api/notes'
import type { FolderNode, NoteListItem, User } from '@/api/types'
import type { ConfirmOptions, ViewContext, ViewProps } from '@/views/types'

import SearchView from '../index'
import TagsView from '../../tags/index'
import BacklinksView from '../../backlinks/index'
import VersionsView from '../../versions/index'
import FavoritesView from '../../favorites/index'
import RecentView from '../../recent/index'

/* 样式由 index.html 的 <link rel="stylesheet" href="../../../index.css"> 引入（Vite 会处理 @import 链） */

interface LabLogs {
  openLog: number[]
  confirmLog: Array<{ title: string; message: string; confirmText: string; danger: boolean }>
  toastLog: string[]
  navigateLog: string[]
  /** 外壳协作类调用的顺序记录：'reloadCurrentNote' / 'refreshNotes' / 'refreshTree' */
  shellCallLog: string[]
}

const LAB_VIEWS: Record<string, ComponentType<ViewProps>> = {
  search: SearchView,
  tags: TagsView,
  backlinks: BacklinksView,
  versions: VersionsView,
  favorites: FavoritesView,
  recent: RecentView,
}

const VIEW_ORDER = ['search', 'tags', 'backlinks', 'versions', 'favorites', 'recent']

function logs(): LabLogs {
  const store = window as unknown as { __labLogs?: LabLogs }
  if (!store.__labLogs) {
    store.__labLogs = {
      openLog: [],
      confirmLog: [],
      toastLog: [],
      navigateLog: [],
      shellCallLog: [],
    }
  }
  return store.__labLogs
}

function parseHash(): { view: string; params: Record<string, string> } {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [view, query] = raw.split('?')
  const params: Record<string, string> = {}
  new URLSearchParams(query ?? '').forEach((value, key) => {
    params[key] = value
  })
  return { view: view || 'search', params }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function relativeTime(iso: string): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return iso
  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return formatDate(iso)
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function Lab() {
  const [route, setRoute] = useState(parseHash)
  const [notes, setNotes] = useState<NoteListItem[]>([])
  const [tree, setTree] = useState<FolderNode[]>([])
  const [user, setUser] = useState<User>({ id: 0, username: 'lab', displayName: 'Lab', role: 'admin' })
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([])
  const [currentNoteId, setCurrentNoteId] = useState<number | null>(null)
  const [metrics, setMetrics] = useState({ doc: '', view: '' })

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const refreshNotes = useCallback(async () => {
    logs().shellCallLog.push('refreshNotes')
    try {
      const page = await listNotes({ size: 200 })
      setNotes(page.items)
    } catch {
      /* lab 里忽略 */
    }
  }, [])

  const refreshTree = useCallback(async () => {
    logs().shellCallLog.push('refreshTree')
    try {
      setTree(await request<FolderNode[]>('/api/folders?tree=true'))
    } catch {
      /* lab 里忽略 */
    }
  }, [])

  /** 真外壳里的实现会重新加载当前笔记正文；lab 只记录调用顺序（形状与 ViewContext 一致） */
  const reloadCurrentNote = useCallback(async () => {
    logs().shellCallLog.push('reloadCurrentNote')
  }, [])

  useEffect(() => {
    void request<User>('/api/auth/me').then(setUser).catch(() => undefined)
    void refreshNotes()
    void refreshTree()
  }, [refreshNotes, refreshTree])

  // 横向溢出实测量：documentElement 与视图根元素
  useEffect(() => {
    const measure = () => {
      const doc = document.documentElement
      const root = document.querySelector('.vw')
      setMetrics({
        doc: `${doc.scrollWidth}/${doc.clientWidth}`,
        view: root ? `${root.scrollWidth}/${root.clientWidth}` : '无 .vw',
      })
    }
    measure()
    const timer = window.setTimeout(measure, 400)
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', measure)
    }
  }, [route])

  const pushToast = useCallback((text: string) => {
    logs().toastLog.push(text)
    setToasts((current) => [...current, { id: Date.now() + Math.random(), text }])
    window.setTimeout(() => {
      setToasts((current) => current.slice(1))
    }, 4000)
  }, [])

  const ctx: ViewContext = useMemo(() => {
    const navigate = (view: string, params?: Record<string, string | number | null | undefined>) => {
      const search = new URLSearchParams()
      Object.entries(params ?? {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
      })
      const query = search.toString()
      const next = `#/${view}${query ? `?${query}` : ''}`
      logs().navigateLog.push(next)
      window.location.hash = next
    }

    return {
      user,
      isAdmin: user.role === 'admin',
      navigate,
      params: route.params,
      toast: {
        info: pushToast,
        success: pushToast,
        error: pushToast,
        warn: pushToast,
      },
      confirm: (options: ConfirmOptions) => {
        logs().confirmLog.push({
          title: options.title,
          message: typeof options.message === 'string' ? options.message : '',
          confirmText: options.confirmText ?? '确定',
          danger: Boolean(options.danger),
        })
        const answer = (window as unknown as { __confirmAnswer?: boolean }).__confirmAnswer
        return Promise.resolve(answer !== false)
      },
      openNote: (id: number) => {
        logs().openLog.push(id)
        setCurrentNoteId(id)
        pushToast(`openNote(${id})`)
      },
      currentNoteId,
      notes,
      knownTitles: notes.map((note) => note.title),
      refreshNotes,
      refreshTree,
      reloadCurrentNote,
      tree,
      relativeTime,
      formatDate,
      formatBytes,
    }
  }, [user, route.params, notes, tree, currentNoteId, refreshNotes, refreshTree, reloadCurrentNote, pushToast])

  const Component = LAB_VIEWS[route.view] ?? SearchView

  return (
    <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', background: 'var(--bg)' }}>
      <nav
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: 'var(--sp-2) var(--sp-4)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <strong style={{ fontSize: 'var(--fs-sm)' }}>视图 lab</strong>
        {VIEW_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            className={`kb-btn kb-btn--sm${route.view === id ? ' kb-btn--primary' : ''}`}
            onClick={() => navigateHash(id)}
          >
            {id}
          </button>
        ))}
        <span id="lab-metrics" className="kb-badge" style={{ marginLeft: 'auto' }}>
          doc {metrics.doc} · view {metrics.view} · notes {notes.length}
        </span>
      </nav>

      <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>
        <Component ctx={ctx} />
      </div>

      <div id="lab-toasts" className="kb-toast-stack" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className="kb-toast kb-toast--info">
            <span className="kb-toast__text">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function navigateHash(view: string) {
  window.location.hash = `#/${view}`
}

const container = document.getElementById('root')
if (container) createRoot(container).render(<Lab />)

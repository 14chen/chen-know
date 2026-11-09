/* AI 简报视图验收 harness：真实视图组件 + 假 ViewContext（契约 @/views/types） */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/components.css'
import '@/styles/views-admin.css'
import BriefingView, { parseSourceReport } from '@/views/briefing/index.tsx'
import type { NoteListItem } from '@/api/types'
import type { ViewContext } from '@/views/types'

const calls = {
  toasts: [] as [string, string][],
  opened: [] as number[],
  navigated: [] as string[],
  refreshNotes: 0,
  refreshTree: 0,
}
const errors: string[] = []
window.addEventListener('error', (e) => errors.push(String(e.message)))
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)))

const notes = [{ id: 3, title: 'AI 简报 2026-10-18' }] as unknown as NoteListItem[]

function makeCtx(): ViewContext {
  return {
    user: { id: 1, username: 'demo', displayName: '演示账号', role: 'admin' } as ViewContext['user'],
    isAdmin: true,
    navigate: (view) => calls.navigated.push(view),
    params: {},
    toast: {
      info: (m) => calls.toasts.push(['info', m]),
      success: (m) => calls.toasts.push(['success', m]),
      error: (m) => calls.toasts.push(['error', m]),
      warn: (m) => calls.toasts.push(['warn', m]),
    },
    confirm: async () => true,
    openNote: (id) => calls.opened.push(id),
    currentNoteId: null,
    notes,
    knownTitles: notes.map((n) => n.title),
    refreshNotes: async () => {
      calls.refreshNotes += 1
    },
    refreshTree: async () => {
      calls.refreshTree += 1
    },
    reloadCurrentNote: async () => {},
    tree: [],
    relativeTime: (iso) => '约 ' + (iso.slice(11, 16) || '未知'),
    formatDate: (iso) => iso.slice(0, 16).replace('T', ' '),
    formatBytes: (n) => n + ' B',
  }
}

let root: Root | null = null
const host = document.getElementById('view-host') as HTMLElement

const api = {
  ready: true,
  calls,
  errors,
  parseSourceReport,
  mount() {
    root?.unmount()
    host.innerHTML = ''
    const el = document.createElement('div')
    el.className = 'kb-editor-region'
    el.style.height = '100vh'
    el.style.display = 'flex'
    host.appendChild(el)
    root = createRoot(el)
    root.render(
      <StrictMode>
        <BriefingView ctx={makeCtx()} />
      </StrictMode>,
    )
    return true
  },
  text: () => document.body.innerText,
  count: (sel: string) => document.querySelectorAll(sel).length,
  clickText(text: string) {
    const target = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text)
    if (!target) return false
    target.click()
    return true
  },
  rects: (sel: string) =>
    Array.from(document.querySelectorAll(sel)).map((el) => {
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height) }
    }),
  links: () =>
    Array.from(document.querySelectorAll('a')).map((a) => ({
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
      text: a.textContent,
    })),
  overflow: () => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
  }),
}

;(window as unknown as { __B: typeof api }).__B = api

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { describeApiError, request } from '@/api/client'
import { logout } from '@/api/auth'
import { createNote, deleteNote, patchNote } from '@/api/notes'
import type { SelectedNoteMeta } from '@/shell/useNotes'
import type { FolderNode, User } from '@/api/types'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { IconAlert, IconFileText, IconMoon, IconPanelLeft, IconSun, IconUsers } from '@/components/Icon'
import { Modal } from '@/components/Modal'
import { Skeleton } from '@/components/Skeleton'
import { useConfirm } from '@/shell/ConfirmProvider'
import { useToast } from '@/components/Toast'
import { findView, findEntry } from '@/views/registry'
import type { ViewContext } from '@/views/types'
import { DigestPanel } from './DigestPanel'
import { EditorSlotProvider } from './editorSlot'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { formatBytes, formatDateTime, formatRelativeTime } from './time'
import { useBreakpoint, isDrawerBreakpoint } from './useResponsive'
import { useHashRoute } from './useHashRoute'
import { useNotes } from './useNotes'
import { collectDescendantIds, countSubtreeNotes, findFolder, useTree } from './useTree'
import type { Theme } from './theme'
import '@/styles/note-meta.css'
import '@/styles/note-outline.css'
import '@/styles/editor-typography.css'

/* 编辑器（CodeMirror）是首屏最大的一块，而未登录时根本用不到：
   拆成独立 chunk 按需加载，登录页只付 React + 应用外壳的体积。 */
const MarkdownEditor = lazy(() =>
  import('@/editor/MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })),
)

/** 从目录树里找出某个目录的完整路径（根 → 叶子） */
function folderPath(tree: FolderNode[], folderId: number | null): FolderNode[] {
  if (folderId === null) return []
  const walk = (nodes: FolderNode[], trail: FolderNode[]): FolderNode[] | null => {
    for (const node of nodes) {
      const next = [...trail, node]
      if (node.id === folderId) return next
      const found = walk(node.children ?? [], next)
      if (found) return found
    }
    return null
  }
  return walk(tree, []) ?? []
}

/**
 * 详情页顶部两行：面包屑（H1）+ 创建/更新/版本（H2）。
 * 只在详情页渲染；数据来自 GET /api/notes/{id}，保存成功后本地自增版本（不重新拉接口）。
 */
function NoteHeaderLines({
  tree,
  meta,
  searchOrigin,
  onHome,
  onFolder,
  onBackToSearch,
}: {
  tree: FolderNode[]
  /** 由 useNotes 提供（打开笔记时一并拿到，保存后 hook 内更新）——不再单独请求 */
  meta: SelectedNoteMeta | null
  searchOrigin: { q: string; params: Record<string, string> } | null
  onHome: () => void
  onFolder: (folderId: number) => void
  onBackToSearch: () => void
}) {
  if (!meta) return null
  const path = folderPath(tree, meta.folderId)

  return (
    <>
      <nav className="kb-crumb" aria-label="面包屑">
        {searchOrigin ? (
          <button type="button" className="kb-crumb__link" onClick={onBackToSearch}>
            搜索「{searchOrigin.q}」
          </button>
        ) : (
          <button type="button" className="kb-crumb__link" onClick={onHome}>
            全部笔记
          </button>
        )}
        {path.length === 0 ? (
          <>
            <span className="kb-crumb__sep" aria-hidden="true">
              /
            </span>
            <span className="kb-crumb__current" aria-current="page">
              未分类
            </span>
          </>
        ) : (
          path.map((node, index) => {
            const isLast = index === path.length - 1
            return (
              <span key={node.id} className="kb-crumb__item">
                <span className="kb-crumb__sep" aria-hidden="true">
                  /
                </span>
                {isLast ? (
                  <span className="kb-crumb__current" aria-current="page">
                    {node.name}
                  </span>
                ) : (
                  <button type="button" className="kb-crumb__link" onClick={() => onFolder(node.id)}>
                    {node.name}
                  </button>
                )}
              </span>
            )
          })
        )}
      </nav>

      <p className="kb-notemeta">
        <span>创建 {formatDateTime(meta.createdAt).slice(0, 10)}</span>
        <span className="kb-notemeta__dot" aria-hidden="true">
          ·
        </span>
        <span title={formatDateTime(meta.updatedAt)}>更新 {formatRelativeTime(meta.updatedAt)}</span>
        <span className="kb-notemeta__dot" aria-hidden="true">
          ·
        </span>
        <span>第 {meta.version} 版</span>
      </p>
    </>
  )
}

/**
 * M4 代码块装饰层：语言标签 + 复制按钮。
 * 只在编辑器**容器外层**补节点（绝对定位覆盖），不往 CodeMirror 注入任何东西、不改其行为。
 */
interface CodeBox {
  key: string
  top: number
  height: number
  lang: string
  code: string
}

/** 从正文源码里按顺序取出每个围栏代码块的语言与内容（DOM 的 cm-kb-code 只给位置） */
export function parseCodeFences(content: string): { lang: string; code: string }[] {
  const lines = content.split(/\r?\n/)
  const out: { lang: string; code: string }[] = []
  const fenceRe = new RegExp('^\\s*([\\u0060~]{3,})\\s*([A-Za-z0-9+#._-]*)')
  let open: string | null = null
  let lang = ''
  let body: string[] = []
  for (const line of lines) {
    const match = line.match(fenceRe)
    if (match) {
      if (open === null) {
        open = match[1][0]
        lang = (match[2] || '').toLowerCase()
        body = []
      } else if (match[1][0] === open) {
        out.push({ lang: lang || '代码', code: body.join('\n') })
        open = null
      }
      continue
    }
    if (open !== null) body.push(line)
  }
  return out
}

function CodeBlockTools({ noteId, content }: { noteId: number; content: string }) {
  const [boxes, setBoxes] = useState<CodeBox[]>([])
  const [copied, setCopied] = useState<string>('')
  const [activeKey, setActiveKey] = useState<string>('')
  const doneRef = useRef<number | null>(null)
  const hideRef = useRef<number | null>(null)
  const breakpoint = useBreakpoint()

  useEffect(() => {
    const pane = document.querySelector('.kb-editor-pane')
    if (!(pane instanceof HTMLElement)) return
    let raf = 0
    const scan = () => {
      raf = 0
      const lines = Array.from(pane.querySelectorAll('.cm-line.cm-kb-code'))
      const paneBox = pane.getBoundingClientRect()
      const groups: HTMLElement[][] = []
      let current: HTMLElement[] = []
      let lastTop = -99999
      for (const line of lines) {
        const top = line.getBoundingClientRect().top
        if (current.length > 0 && top - lastTop > 40) {
          groups.push(current)
          current = []
        }
        current.push(line as HTMLElement)
        lastTop = top
      }
      if (current.length > 0) groups.push(current)
      const next: CodeBox[] = []
      const fences = parseCodeFences(content)
      groups.forEach((group, index) => {
        const head = group[0]
        const rect = head.getBoundingClientRect()
        const fence = fences[index]
        const last = group[group.length - 1].getBoundingClientRect()
        next.push({
          key: index + '-' + Math.round(rect.top),
          top: rect.top - paneBox.top - 2,
          height: Math.max(20, last.bottom - rect.top),
          lang: fence ? fence.lang : '代码',
          code: fence ? fence.code : group.map((line) => line.textContent ?? '').join('\n'),
        })
      })
      setBoxes((prev) =>
        prev.length === next.length &&
        prev.every((box, index) => box.key === next[index]?.key && box.lang === next[index]?.lang)
          ? prev
          : next,
      );
    };
    const schedule = () => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(scan);
    };
    scan()
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const timer = window.setInterval(schedule, 600)
    return () => {
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.clearInterval(timer)
      if (raf !== 0) window.cancelAnimationFrame(raf)
      if (doneRef.current !== null) window.clearTimeout(doneRef.current)
    };
  }, [noteId, content]);

  // 悬停 or 光标进入该代码块 → 显示工具条；离开 300ms 后隐藏（避免移向按钮途中消失）
  useEffect(() => {
    if (boxes.length === 0) return
    const pane = document.querySelector('.kb-editor-pane')
    if (!(pane instanceof HTMLElement)) return
    const cancel = () => {
      if (hideRef.current !== null) {
        window.clearTimeout(hideRef.current)
        hideRef.current = null
      }
    }
    const show = (key: string) => {
      cancel()
      setActiveKey((prev) => (prev === key ? prev : key))
    }
    const scheduleHide = () => {
      cancel()
      hideRef.current = window.setTimeout(() => setActiveKey(''), 300)
    }
    const paneBox = () => pane.getBoundingClientRect()
    const hitAt = (element: Element | null): string => {
      const line = element ? element.closest('.cm-line') : null
      if (!line || !line.classList.contains('cm-kb-code')) return ''
      const y = line.getBoundingClientRect().top - paneBox().top
      const hit = boxes.find((box) => y >= box.top - 12 && y <= box.top + box.height + 12)
      return hit ? hit.key : ''
    }
    const onOver = (event: Event) => {
      const key = hitAt(event.target instanceof Element ? event.target : null)
      if (key) show(key)
      else if ((event.target as Element | null)?.closest?.('.kb-codeb__box')) cancel()
      else scheduleHide()
    }
    const onSelection = () => {
      const selection = document.getSelection()
      const node = selection && selection.anchorNode
      const element = node instanceof Element ? node : node?.parentElement ?? null
      const line = element ? element.closest('.cm-line') : null
      if (line && line.classList.contains('cm-kb-code')) {
        const y = line.getBoundingClientRect().top - paneBox().top
        const hit = boxes.find((box) => Math.abs(box.top - y) < 8 || (y >= box.top && y <= box.top + box.height))
        if (hit) show(hit.key)
      }
    }
    pane.addEventListener('mouseover', onOver)
    pane.addEventListener('mouseleave', scheduleHide)
    document.addEventListener('selectionchange', onSelection)
    return () => {
      cancel()
      pane.removeEventListener('mouseover', onOver)
      pane.removeEventListener('mouseleave', scheduleHide)
      document.removeEventListener('selectionchange', onSelection)
    }
  }, [boxes])

  const copy = useCallback(async (box: CodeBox) => {
    try {
      await navigator.clipboard.writeText(box.code)
    } catch {
      const area = document.createElement('textarea');
      area.value = box.code;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopied(box.key);
    if (doneRef.current !== null) window.clearTimeout(doneRef.current)
    doneRef.current = window.setTimeout(() => setCopied(''), 2000);
  }, []);

  if (boxes.length === 0) return null
  if (breakpoint === 'phone' || breakpoint === 'tablet') return null

  return (
    <div className="kb-codeb" aria-hidden="true">
      {boxes.map((box) => (
        <div
          key={box.key}
          className={'kb-codeb__box' + (activeKey === box.key ? ' is-shown' : '')}
          style={{ top: box.top, right: 8 }}
        >
          <span className="kb-codeb__lang">{box.lang}</span>
          <button
            type="button"
            className={'kb-codeb__copy' + (copied === box.key ? ' is-done' : '')}
            aria-label={copied === box.key ? '已复制' : '复制这段代码'}
            onClick={() => void copy(box)}
          >
            {copied === box.key ? '已复制' : '复制'}
          </button>
        </div>
      ))}
    </div>
  )
}
/* --------------------------------------------------- M1 文章大纲 */

interface OutlineItem {
  level: number
  text: string
  /** 在正文里的行号（0 基）：先按比例粗定位，再在渲染出来的标题行上做精确修正 */
  line: number
}

/** 从 Markdown 正文解析 # / ## / ###；**跳过围栏代码块**（三反引号 / ~~~ 里以 # 开头的行不算标题） */
export function parseOutline(content: string): OutlineItem[] {
  const lines = content.split(/\r?\n/)
  const items: OutlineItem[] = []
  const fenceRe = new RegExp('^\\s*([\\u0060~]{3,})')
  let fence: string | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const fenceMatch = raw.match(fenceRe)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence !== null) continue
    const heading = raw.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/)
    if (!heading) continue
    items.push({ level: heading[1].length, text: heading[2].trim(), line: index })
  }
  return items
}

const OUTLINE_OPEN_KEY = 'kb.outline.open'
const OUTLINE_MAX = 30

function NoteOutline({ content, noteId }: { content: string; noteId: number }) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(OUTLINE_OPEN_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [activeIdx, setActiveIdx] = useState(-1)
  const [mobileOpen, setMobileOpen] = useState(false)
  const breakpoint = useBreakpoint()
  const items = useMemo(() => parseOutline(content), [content])
  const shown = useMemo(() => items.slice(0, OUTLINE_MAX), [items])
  // 实际断点：desktop ≥1280 / laptop 1024–1279 / tablet 768–1023 / phone ≤767
  //   → 桌面常驻面板；笔记本（1024–1279，含方案里的 900–1179 平板）默认收起 + 右侧抽屉；
  //     平板/手机（≤1023）改顶部「目录」按钮 + 底部抽屉
  const tablet = breakpoint === 'laptop'
  const phone = breakpoint === 'tablet' || breakpoint === 'phone'
  // 正文右侧还剩多少留白：够就内嵌一个「刚好放得下」的面板，不够就降级成抽屉（绝不压正文）
  const [gutter, setGutter] = useState(0)
  useEffect(() => {
    const measure = () => {
      const content = document.querySelector('.kb-editor-pane .cm-content')
      const right = content instanceof HTMLElement ? content.getBoundingClientRect().right : 0
      setGutter(right > 0 ? Math.max(0, window.innerWidth - right) : 0)
    }
    measure()
    window.addEventListener('resize', measure)
    const timer = window.setInterval(measure, 700)
    return () => {
      window.removeEventListener('resize', measure)
      window.clearInterval(timer)
    }
  }, [content, open])
  const panelWidth = Math.max(112, Math.min(200, Math.round(gutter - 32)))
  const canInline = !tablet && gutter >= 130

  const toggleOpen = useCallback(() => {
    setOpen((current) => {
      const next = !current
      try {
        window.localStorage.setItem(OUTLINE_OPEN_KEY, next ? '1' : '0')
      } catch {
        /* 存不了就算了 */
      }
      return next
    })
  }, [])

  const jumpTo = useCallback(
    (item: OutlineItem) => {
      const scroller = document.querySelector('.kb-editor-pane .cm-scroller')
      const totalLines = content.split(/\r?\n/).length || 1
      if (scroller instanceof HTMLElement) {
        const ratio = item.line / totalLines
        scroller.scrollTo({ top: Math.max(0, ratio * scroller.scrollHeight - 80), behavior: 'smooth' })
      }
      setActiveIdx(shown.findIndex((candidate) => candidate.line === item.line))
      setMobileOpen(false)
      window.setTimeout(() => {
        const headingLines = document.querySelectorAll(
          '.kb-editor-pane .cm-line.cm-kb-h1, .kb-editor-pane .cm-line.cm-kb-h2, .kb-editor-pane .cm-line.cm-kb-h3',
        )
        for (const line of Array.from(headingLines)) {
          if ((line.textContent ?? '').replace(/^#+\s*/, '').trim() === item.text) {
            line.scrollIntoView({ behavior: 'smooth', block: 'start' })
            break
          }
        }
      }, 320)
    },
    [content, shown],
  )

  // 高亮：IntersectionObserver 观察渲染出来的标题行（不是每帧算）
  useEffect(() => {
    if (!open || items.length === 0) return
    const root = document.querySelector('.kb-editor-pane .cm-scroller')
    const targets = document.querySelectorAll(
      '.kb-editor-pane .cm-line.cm-kb-h1, .kb-editor-pane .cm-line.cm-kb-h2, .kb-editor-pane .cm-line.cm-kb-h3',
    )
    if (!root || targets.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting)
        if (!visible) return
        const text = (visible.target.textContent ?? '').replace(/^#+\s*/, '').trim()
        const idx = shown.findIndex((item) => item.text === text)
        if (idx >= 0) setActiveIdx(idx)
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    )
    targets.forEach((target) => observer.observe(target))
    return () => observer.disconnect()
  }, [open, items, shown, noteId, content])

  if (items.length <= 1) return null

  const list = (
    <ul className="kb-outline__list">
      {shown.map((item, index) => (
        <li key={item.line}>
          <button
            type="button"
            className={
              'kb-outline__item kb-outline__item--l' + item.level + (activeIdx === index ? ' is-active' : '')
            }
            aria-current={activeIdx === index ? 'true' : undefined}
            onClick={() => jumpTo(item)}
            title={item.text}
          >
            {item.text}
          </button>
        </li>
      ))}
      {items.length > OUTLINE_MAX ? (
        <li className="kb-outline__more">共 {items.length} 个标题（只显示前 {OUTLINE_MAX} 个）</li>
      ) : null}
    </ul>
  )

  if (phone) {
    return (
      <div className="kb-outline kb-outline--mobile">
        <button
          type="button"
          className="kb-outline__toggle"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((current) => !current)}
        >
          目录 ({items.length})
        </button>
        {mobileOpen ? (
          <>
            <div className="kb-outline__scrim" onClick={() => setMobileOpen(false)} />
            <div className="kb-outline__sheet" role="dialog" aria-label="文章目录">
              <div className="kb-outline__sheet-head">
                <span>目录</span>
                <button type="button" className="kb-outline__close" onClick={() => setMobileOpen(false)}>
                  关闭
                </button>
              </div>
              {list}
            </div>
          </>
        ) : null}
      </div>
    )
  }

  if (tablet || !canInline) {
    return (
      <div className="kb-outline kb-outline--drawer">
        <button
          type="button"
          className="kb-outline__collapsed"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((current) => !current)}
          title="展开文章大纲"
        >
          目录 ({items.length})
        </button>
        {mobileOpen ? (
          <>
            <div className="kb-outline__scrim" onClick={() => setMobileOpen(false)} />
            <div className="kb-outline__side" role="dialog" aria-label="文章大纲">
              <div className="kb-outline__sheet-head">
                <span>大纲</span>
                <button type="button" className="kb-outline__close" onClick={() => setMobileOpen(false)}>
                  关闭
                </button>
              </div>
              {list}
            </div>
          </>
        ) : null}
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" className="kb-outline kb-outline__collapsed" onClick={toggleOpen} title="展开文章大纲">
        目录
      </button>
    )
  }

  return (
    <aside className="kb-outline" aria-label="文章大纲" style={{ width: panelWidth + 'px' }}>
      <div className="kb-outline__head">
        <span>大纲</span>
        <button type="button" className="kb-outline__collapse" onClick={toggleOpen} aria-label="收起大纲">
          收起
        </button>
      </div>
      {list}
    </aside>
  )
}

/** M2 阅读进度条：绑在编辑器的 .cm-scroller 上；滚动时浮现，停 1.5s 淡出 */
function ReadingProgress({ noteId }: { noteId: number }) {
  const [percent, setPercent] = useState(0)
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    // 每帧都不缓存元素：编辑器重挂载（key=noteId）后依然绑得对；滚动事件用捕获阶段监听 document
    const findScroller = (): HTMLElement | null => {
      const el = document.querySelector('.kb-editor-pane .cm-scroller')
      return el instanceof HTMLElement ? el : null
    }
    const update = () => {
      const el = findScroller()
      if (!el) return
      const max = el.scrollHeight - el.clientHeight
      setPercent(max > 4 ? Math.min(100, Math.max(0, (el.scrollTop / max) * 100)) : 0)
    }
    update()
    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.classList.contains('cm-scroller')) return
      update()
      setVisible(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setVisible(false), 1500)
    }
    document.addEventListener('scroll', onScroll, true)
    const onResize = () => update()
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [noteId])

  return (
    <div className="kb-progress" aria-hidden="true">
      <div className={'kb-progress__bar' + (visible ? ' is-visible' : '')} style={{ width: percent + '%' }} />
    </div>
  )
}

/* ------------------------------------------------- M3 相关推荐 */

interface RelatedNote {
  id: number
  title: string
  folderName?: string | null
  reason: string
  reasonLabel: string
  score: number
}

function RelatedNotes({ noteId, onOpen }: { noteId: number; onOpen: (id: number) => void }) {
  const [items, setItems] = useState<RelatedNote[] | null>(null)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setItems(null)
    setSlow(false)
    // 300ms 还没回来才显示骨架，避免闪一下
    const timer = window.setTimeout(() => setSlow(true), 300)
    request<{ items: RelatedNote[] }>('/api/notes/' + noteId + '/related?limit=5', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setItems(Array.isArray(result.items) ? result.items : [])
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        // 相关推荐不是核心功能：静默隐藏，只留一条 warn
        console.warn('[相关推荐] 加载失败，已隐藏该区块', error)
        setItems([])
      })
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    };
  }, [noteId])

  if (items === null) {
    if (!slow) return null
    return (
      <section className="kb-related" aria-busy="true">
        <div className="kb-related__head">
          <h2 className="kb-related__title">相关笔记</h2>
        </div>
        {[0, 1, 2].map((row) => (
          <div key={row} className="kb-related__skeleton">
            <Skeleton width="52%" height={12} />
          </div>
        ))}
      </section>
    )
  }
  if (items.length === 0) return null

  return (
    <section className="kb-related" aria-label="相关笔记">
      <div className="kb-related__head">
        <h2 className="kb-related__title">相关笔记</h2>
        <span className="kb-related__count">{items.length} 条</span>
      </div>
      <ul className="kb-related__list">
        {items.slice(0, 5).map((item) => (
          <li key={item.id}>
            <button type="button" className="kb-related__row" onClick={() => onOpen(item.id)}>
              <span className="kb-related__name">{item.title || '未命名笔记'}</span>
              <span className="kb-related__reason">{item.reasonLabel}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
/** 正文下方：上一篇 / 下一篇（顺序 = 当前可见列表） */
function NotePrevNext({
  items,
  currentId,
  onOpen,
}: {
  items: { id: number; title: string }[]
  currentId: number
  onOpen: (id: number) => void
}) {
  const index = items.findIndex((item) => item.id === currentId)
  if (index < 0) return null
  const prev = index > 0 ? items[index - 1] : null
  const next = index < items.length - 1 ? items[index + 1] : null
  if (!prev && !next) return null
  return (
    <nav className="kb-pn" aria-label="上一篇 / 下一篇">
      {prev ? (
        <button type="button" className="kb-pn__card is-prev" onClick={() => onOpen(prev.id)}>
          <span className="kb-pn__dir">← 上一篇</span>
          <span className="kb-pn__title">{prev.title || '未命名笔记'}</span>
        </button>
      ) : null}
      {next ? (
        <button type="button" className="kb-pn__card is-next" onClick={() => onOpen(next.id)}>
          <span className="kb-pn__dir">下一篇 →</span>
          <span className="kb-pn__title">{next.title || '未命名笔记'}</span>
        </button>
      ) : null}
    </nav>
  )
}

const SIDEBAR_STORAGE_KEY = 'kb.sidebar'
const EDITOR_WIDTH_KEY = 'kb.editorWidth'

function readCollapsedPreference(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed'
  } catch {
    return false
  }
}

/** 编辑器宽度偏好：'wide' = 占满可用宽度；其余（含未设置）= 窄栏居中 */
function readEditorWide(): boolean {
  try {
    return localStorage.getItem(EDITOR_WIDTH_KEY) === 'wide'
  } catch {
    return false
  }
}

export interface AppShellProps {
  user: User
  theme: Theme
  onToggleTheme: () => void
  onLoggedOut: () => void
}

export function AppShell({ user, theme, onToggleTheme, onLoggedOut }: AppShellProps) {
  const toast = useToast()
  const confirm = useConfirm()
  const notes = useNotes()
  const tree = useTree()
  const { route, navigate } = useHashRoute()
  const breakpoint = useBreakpoint()
  const drawerMode = isDrawerBreakpoint(breakpoint)
  const compact = breakpoint === 'phone'

  const isAdmin = user.role === 'admin'

  const [collapsed, setCollapsed] = useState(readCollapsedPreference)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editorWide, setEditorWide] = useState(readEditorWide)
  const [folderFilter, setFolderFilter] = useState<number | null>(null)
  const [creatingNote, setCreatingNote] = useState(false)
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  /** 请求顶栏标题进入编辑态的信号（笔记项菜单「重命名」用） */
  const [renameSignal, setRenameSignal] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)
  const lastOpenedRef = useRef<number | null>(null)
  const unknownRouteRef = useRef<string | null>(null)

  const { saveNow, select, changeContent, uploadImage } = notes
  const selectedId = notes.selectedId
  const knownTitles = notes.knownTitles
  const items = notes.items

  /* ---- 路由 → 视图 ------------------------------------------------------ */
  const requested = route.view === '' ? 'notes' : route.view
  const known = findEntry(requested) !== undefined
  const activeViewId = known ? requested : 'notes'
  const activeView = findView(activeViewId)
  const denied = activeView?.adminOnly === true && !isAdmin

  useEffect(() => {
    if (known) {
      unknownRouteRef.current = null
      return
    }
    if (unknownRouteRef.current === requested) return
    unknownRouteRef.current = requested
    toast.warn(`未知路由 #/${requested}，已回到笔记视图`)
  }, [known, requested, toast])

  const deniedWarnedRef = useRef(false)
  useEffect(() => {
    if (!denied) {
      deniedWarnedRef.current = false
      return
    }
    if (deniedWarnedRef.current) return
    deniedWarnedRef.current = true
    toast.warn('该视图仅管理员可用')
  }, [denied, toast])

  /* ---- 视口：进入抽屉模式时收起抽屉 ------------------------------------ */
  useEffect(() => {
    if (drawerMode) setDrawerOpen(false)
  }, [drawerMode])

  useEffect(() => {
    if (drawerMode) return
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded')
    } catch {
      /* 忽略存储失败 */
    }
  }, [collapsed, drawerMode])

  useEffect(() => {
    try {
      localStorage.setItem(EDITOR_WIDTH_KEY, editorWide ? 'wide' : 'narrow')
    } catch {
      /* 忽略存储失败 */
    }
  }, [editorWide])

  useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  /* ---- 落到 #/notes[/id]：换笔记（切换前 useNotes 会先落盘）--------------- */
  useEffect(() => {
    if (requested !== 'notes') return
    if (!route.id) return
    const id = Number(route.id)
    if (!Number.isFinite(id) || id <= 0 || id === selectedId) return

    select(id).then(
      () => {
        lastOpenedRef.current = id
      },
      () => {
        // 落盘失败：把地址栏退回上一篇，保持「看到的 = 地址栏」
        navigate('notes', { id: lastOpenedRef.current })
      },
    )
  }, [requested, route.id, selectedId, select, navigate])

  /* ---- 首次进入 / 无 id 时自动打开第一篇 -------------------------------- */
  useEffect(() => {
    if (requested !== 'notes' || route.id) return
    if (notes.listLoading || selectedId !== null) return
    const first = items[0]
    if (first) navigate('notes', { id: first.id })
  }, [requested, route.id, notes.listLoading, selectedId, items, navigate])

  /* ---- 打开的笔记若已不在列表中（被删/移入回收站）→ 回第一篇 ------------ */
  useEffect(() => {
    if (notes.listLoading || notes.listError) return
    if (selectedId === null) return
    if (items.some((item) => item.id === selectedId)) return
    const first = items[0]
    if (first) navigate('notes', { id: first.id })
    else navigate('notes')
  }, [notes.listLoading, notes.listError, selectedId, items, navigate])

  useEffect(() => {
    document.title =
      requested === 'notes' && notes.selectedTitle
        ? `${notes.selectedTitle} · 知识库`
        : `${activeView?.title ?? '知识库'} · 知识库`
  }, [requested, notes.selectedTitle, activeView])

  /* ---- 详情页：记住「从搜索点进来」的来源，供面包屑回跳 ------------- */
  const [searchOrigin, setSearchOrigin] = useState<{ q: string; params: Record<string, string> } | null>(null)
  const lastRouteRef = useRef<{ view: string; params: Record<string, string> }>({
    view: route.view,
    params: route.params,
  })
  useEffect(() => {
    const previous = lastRouteRef.current
    if (route.view === 'notes' && previous.view === 'search') {
      setSearchOrigin({ q: previous.params.q ?? '', params: previous.params })
    } else if (route.view === 'search') {
      setSearchOrigin(null)
    }
    lastRouteRef.current = { view: route.view, params: route.params }
  }, [route.view, route.params])

  /* ---- 笔记列表：目录过滤（全量已在内存，客户端过滤足够快）------------- */
  const visibleNotes = useMemo(() => {
    if (folderFilter === null) return items
    if (folderFilter === 0) return items.filter((item) => item.folderId === null)
    return items.filter((item) => item.folderId === folderFilter)
  }, [items, folderFilter])

  const folderCounts = useMemo(
    () => ({
      all: items.length,
      unclassified: items.filter((item) => item.folderId === null).length,
    }),
    [items],
  )

  const truncation = notes.listTruncated
    ? { total: notes.listTotal, loaded: items.length }
    : null

  /* ---- 交互 ------------------------------------------------------------ */

  /** 硬要求：切换视图前先把未保存改动落盘 */
  const navigateWithFlush = useCallback(
    (view: string, params?: Record<string, string | number | null | undefined>) => {
      void saveNow().then(() => navigate(view, params))
    },
    [saveNow, navigate],
  )

  const openNote = useCallback(
    (id: number) => {
      if (drawerMode) setDrawerOpen(false)
      navigateWithFlush('notes', { id })
    },
    [drawerMode, navigateWithFlush],
  )

  const handleSelectNote = useCallback(
    (id: number) => {
      if (drawerMode) setDrawerOpen(false)
      navigateWithFlush('notes', { id })
    },
    [drawerMode, navigateWithFlush],
  )

  const handleWikiLinkClick = useCallback(
    (title: string) => {
      const wanted = title.trim()
      const target =
        items.find((item) => item.title.trim() === wanted) ??
        items.find((item) => item.title.trim().toLowerCase() === wanted.toLowerCase())

      if (target) {
        handleSelectNote(target.id)
        return
      }
      toast.info(`该笔记还不存在：「${wanted}」`)
    },
    [items, handleSelectNote, toast],
  )

  /* ---- Alt + ←/→ 在可见列表里前后翻（编辑器内也生效）---- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (selectedId === null) return
      const index = visibleNotes.findIndex((item) => item.id === selectedId)
      if (index < 0) return
      const target = event.key === 'ArrowLeft' ? visibleNotes[index - 1] : visibleNotes[index + 1]
      if (!target) return
      event.preventDefault()
      event.stopPropagation()
      navigateWithFlush('notes', { id: target.id })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [selectedId, visibleNotes, navigateWithFlush])

  const handleCreateNote = useCallback(async () => {
    setCreatingNote(true)
    try {
      const target = folderFilter !== null && folderFilter > 0 ? folderFilter : null
      const created = await createNote({ folderId: target, title: '未命名笔记', content: '' })
      await notes.reload()
      await tree.reload()
      navigateWithFlush('notes', { id: created.id })
    } catch (error) {
      toast.error(`新建笔记失败：${describeApiError(error)}`)
    } finally {
      setCreatingNote(false)
    }
  }, [folderFilter, notes, tree, navigateWithFlush, toast])

  /** 删除一篇笔记：二次确认 → deleteNote → 从列表移除；删的是当前笔记则切到下一篇 */
  const handleDeleteNote = useCallback(
    async (id: number) => {
      const target = items.find((item) => item.id === id)
      const ok = await confirm({
        title: `删除「${target?.title || '无标题'}」？`,
        message: '笔记将移入回收站，可随时恢复。',
        confirmText: '删除',
        danger: true,
      })
      if (!ok) return

      const wasOpen = selectedId === id
      // 先落盘：否则删除后仍可能有排队中的 PATCH 打到这篇已删笔记
      if (wasOpen) await saveNow()

      try {
        await deleteNote(id)
      } catch (error) {
        toast.error(`删除失败：${describeApiError(error)}`)
        return
      }

      // 「下一篇」按当前可见（已按目录过滤）的列表顺序取，取不到就取上一篇
      const index = visibleNotes.findIndex((item) => item.id === id)
      const next =
        index >= 0 ? (visibleNotes[index + 1] ?? visibleNotes[index - 1] ?? null) : null

      // 先登记「已删除」：此后地址栏残留的 id 不会再触发 getNote（原先会打 2 次 404）
      notes.markDeleted(id)
      if (wasOpen) notes.clear()
      await notes.reload()
      if (next) navigateWithFlush('notes', { id: next.id })
      else if (wasOpen) navigate('notes')
      toast.success('已移入回收站')
    },
    [confirm, items, visibleNotes, selectedId, saveNow, notes, navigateWithFlush, navigate, toast],
  )

  /** 改标题：空/空白标题兜底为「未命名笔记」并提示 */
  const handleRenameNote = useCallback(
    async (id: number, raw: string) => {
      const trimmed = raw.trim()
      try {
        const finalTitle = await notes.renameNote(id, trimmed)
        if (!trimmed) toast.info(`标题不能为空，已保存为「${finalTitle}」`)
        else toast.success('标题已更新')
      } catch (error) {
        toast.error(`重命名失败：${describeApiError(error)}`)
      }
    },
    [notes, toast],
  )

  /** 笔记项菜单「重命名」：先打开该篇，再让顶栏标题进入编辑态 */
  const handleStartRename = useCallback(
    (id: number) => {
      if (id !== selectedId) openNote(id)
      setRenameSignal((value) => value + 1)
    },
    [selectedId, openNote],
  )

  const handleDropNote = useCallback(
    async (noteId: number, folderId: number | null) => {
      try {
        await patchNote(noteId, { folderId })
        await notes.reload()
        void tree.reload()
        const name = folderId === null ? '未分类' : (findFolder(tree.tree, folderId)?.name ?? '目录')
        toast.success(`已把笔记移到「${name}」`)
      } catch (error) {
        toast.error(`移动笔记失败：${describeApiError(error)}`)
      }
    },
    [notes, tree, toast],
  )

  const handleDeleteFolder = useCallback(
    async (node: FolderNode) => {
      const descendantIds = collectDescendantIds(node)
      const noteTotal = countSubtreeNotes(node)
      const folderPart =
        descendantIds.length > 0
          ? `该目录及其 ${descendantIds.length} 个子目录`
          : '该目录'
      const notePart =
        noteTotal > 0 ? `，其中 ${noteTotal} 篇笔记也会一起进入回收站` : '（目录内没有笔记）'

      const ok = await confirm({
        title: `删除目录「${node.name}」？`,
        message: `${folderPart}${notePart}。回收站里的内容可以恢复，但恢复前不会出现在目录树与笔记列表中。`,
        confirmText: '删除',
        danger: true,
      })
      if (!ok) return

      const removed = await tree.remove(node.id)
      if (!removed) return

      await notes.reload()
      setFolderFilter((current) => {
        if (current === null) return current
        if (current === node.id || descendantIds.includes(current)) return null
        return current
      })
      toast.success(`目录「${node.name}」已移入回收站`)
    },
    [confirm, tree, notes, toast],
  )

  const handleLogout = useCallback(async () => {
    setLoggingOut(true)
    // 先尽力落盘，避免退出登录丢掉未保存的改动
    await saveNow()
    try {
      await logout()
    } catch {
      /* 会话可能已失效：照样回登录页 */
    }
    setLoggingOut(false)
    setConfirmingLogout(false)
    onLoggedOut()
  }, [saveNow, onLoggedOut])

  /* ---- ViewContext（冻结接口，逐字段落地）------------------------------ */
  const ctx = useMemo<ViewContext>(
    () => ({
      user,
      isAdmin,
      navigate: navigateWithFlush,
      params: route.params,
      toast,
      confirm,
      openNote,
      currentNoteId: selectedId,
      notes: items,
      knownTitles,
      refreshNotes: notes.reload,
      reloadCurrentNote: notes.reloadCurrentNote,
      refreshTree: tree.reload,
      tree: tree.tree,
      relativeTime: formatRelativeTime,
      formatDate: formatDateTime,
      formatBytes,
    }),
    [
      user,
      isAdmin,
      navigateWithFlush,
      route.params,
      toast,
      confirm,
      openNote,
      selectedId,
      items,
      knownTitles,
      notes.reload,
      notes.reloadCurrentNote,
      tree.reload,
      tree.tree,
    ],
  )

  /* ---- 笔记视图（编辑器）---------------------------------------------- */
  let editorArea: ReactNode
  if (notes.noteLoading) {
    editorArea = (
      <div className="kb-editor-pane">
        <div className="kb-editor-skeleton">
          <Skeleton width="46%" height={26} />
          <Skeleton width="100%" height={13} />
          <Skeleton width="92%" height={13} />
          <Skeleton width="96%" height={13} />
          <Skeleton width="70%" height={13} />
          <Skeleton width="100%" height={13} />
          <Skeleton width="85%" height={13} />
        </div>
      </div>
    )
  } else if (notes.noteError) {
    editorArea = (
      <div className="kb-editor-placeholder">
        <EmptyState
          icon={<IconAlert size={22} />}
          title="打开笔记失败"
          desc={notes.noteError}
          action={
            selectedId !== null ? (
              <Button size="sm" onClick={() => navigateWithFlush('notes', { id: selectedId })}>
                重试
              </Button>
            ) : null
          }
        />
      </div>
    )
  } else if (selectedId !== null) {
    editorArea = (
      <div className="kb-editor-pane">
        <ReadingProgress noteId={selectedId} />
        <NoteHeaderLines
          tree={tree.tree}
          meta={notes.selectedMeta}
          searchOrigin={searchOrigin}
          onHome={() => {
            setFolderFilter(null)
            navigateWithFlush('notes', {})
          }}
          onFolder={(folderId) => {
            setFolderFilter(folderId)
            navigateWithFlush('notes', {})
          }}
          onBackToSearch={() => {
            navigateWithFlush('search', searchOrigin ? searchOrigin.params : {})
          }}
        />
        <DigestPanel noteId={selectedId} digest={notes.selectedDigest} />
        <CodeBlockTools noteId={selectedId} content={notes.content} />
        <Suspense fallback={<div className="kb-editor-placeholder" aria-busy="true" />}>
          <MarkdownEditor
            key={selectedId}
            value={notes.content}
            onChange={changeContent}
            noteTitle={notes.selectedTitle}
            knownTitles={knownTitles}
            onWikiLinkClick={handleWikiLinkClick}
            onUploadImage={uploadImage}
            onSave={saveNow}
          />
        </Suspense>
        <NotePrevNext
          items={visibleNotes}
          currentId={selectedId}
          onOpen={(id) => navigateWithFlush('notes', { id })}
        />
        <RelatedNotes noteId={selectedId} onOpen={(id) => navigateWithFlush('notes', { id })} />
        <NoteOutline content={notes.content} noteId={selectedId} />
      </div>
    )
  } else {
    editorArea = (
      <div className="kb-editor-placeholder">
        <EmptyState
          icon={<IconFileText size={22} />}
          title="还没有打开笔记"
          desc="从左侧列表选择一篇笔记开始编辑"
        />
      </div>
    )
  }

  const ActiveComponent = activeView?.component

  return (
    <div
      className={[
        'kb-app',
        drawerMode ? 'kb-app--drawer' : '',
        !drawerMode && collapsed ? 'kb-app--collapsed' : '',
        drawerMode && drawerOpen ? 'kb-app--drawer-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {!drawerMode && collapsed ? (
        <div className="kb-rail">
          <Button
            variant="icon"
            onClick={() => setCollapsed(false)}
            aria-label="展开左栏"
            title="展开左栏"
          >
            <IconPanelLeft size={18} />
          </Button>
          <span className="kb-rail__spacer" />
          <Button
            variant="icon"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </Button>
        </div>
      ) : null}

      <aside
        className="kb-sidebar"
        aria-label="侧栏"
        // 收起/关闭时整块移出可达性树，避免键盘焦点落进看不见的抽屉
        inert={(!drawerMode && collapsed) || (drawerMode && !drawerOpen) ? true : undefined}
      >
        <Sidebar
          user={user}
          isAdmin={isAdmin}
          activeViewId={activeViewId}
          onNavigateView={(viewId) => {
            if (drawerMode) setDrawerOpen(false)
            navigateWithFlush(viewId)
          }}
          tree={tree.tree}
          treeLoading={tree.loading}
          treeError={tree.error}
          onTreeReload={() => {
            void tree.reload()
          }}
          folderFilter={folderFilter}
          folderCounts={folderCounts}
          onFolderFilter={(filter) => {
            if (drawerMode) setDrawerOpen(false)
            setFolderFilter(filter)
          }}
          onCreateFolder={tree.create}
          onRenameFolder={tree.rename}
          onMoveFolder={(id, parentId) => {
            void tree.move(id, parentId)
          }}
          onDeleteFolder={(node) => {
            void handleDeleteFolder(node)
          }}
          onDropNote={(noteId, folderId) => {
            void handleDropNote(noteId, folderId)
          }}
          notes={visibleNotes}
          notesLoading={notes.listLoading}
          notesError={notes.listError}
          notesTruncation={truncation}
          selectedNoteId={selectedId}
          dirtyNoteId={notes.hasUnsavedChanges ? selectedId : null}
          onSelectNote={handleSelectNote}
          onReloadNotes={() => {
            void notes.reload()
          }}
          onCreateNote={() => {
            void handleCreateNote()
          }}
          creatingNote={creatingNote}
          onDeleteNote={(id) => {
            void handleDeleteNote(id)
          }}
          onRenameNote={handleStartRename}
          onCollapse={() => {
            if (drawerMode) setDrawerOpen(false)
            else setCollapsed(true)
          }}
          onLogout={() => setConfirmingLogout(true)}
        />
      </aside>

      {drawerMode && drawerOpen ? (
        <div
          className="kb-drawer-scrim"
          data-testid="drawer-scrim"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <main className="kb-main">
        <Topbar
          viewTitle={activeView?.title ?? '知识库'}
          noteTitle={activeViewId === 'notes' ? notes.selectedTitle || null : null}
          showSaveStatus={activeViewId === 'notes' && selectedId !== null && !notes.noteLoading}
          saveState={notes.saveState}
          savedAt={notes.savedAt}
          onRetrySave={() => {
            void saveNow()
          }}
          theme={theme}
          onToggleTheme={onToggleTheme}
          drawerMode={drawerMode}
          compact={compact}
          onToggleSidebar={() => {
            if (drawerMode) setDrawerOpen((open) => !open)
            else setCollapsed((value) => !value)
          }}
          onSearch={(query) => navigateWithFlush('search', { q: query })}
          editorWide={editorWide}
          renameSignal={renameSignal}
          onRenameNote={selectedId !== null ? (next) => handleRenameNote(selectedId, next) : undefined}
          onToggleEditorWidth={() => setEditorWide((value) => !value)}
        />

        <section
          className={['kb-editor-region', editorWide ? 'kb-editor-region--wide' : '']
            .filter(Boolean)
            .join(' ')}
        >
          <EditorSlotProvider value={editorArea}>
            {denied ? (
              <div className="kb-editor-placeholder">
                <EmptyState
                  icon={<IconUsers size={22} />}
                  title="仅管理员可用"
                  desc={`「${activeView?.title ?? ''}」需要管理员权限，当前账号是成员。`}
                  action={
                    <Button size="sm" onClick={() => navigateWithFlush('notes')}>
                      回到笔记
                    </Button>
                  }
                />
              </div>
            ) : ActiveComponent ? (
              <ActiveComponent ctx={ctx} />
            ) : null}
          </EditorSlotProvider>
        </section>
      </main>

      <Modal
        open={confirmingLogout}
        title="退出登录"
        onClose={() => {
          if (!loggingOut) setConfirmingLogout(false)
        }}
        footer={
          <>
            <Button onClick={() => setConfirmingLogout(false)} disabled={loggingOut}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={loggingOut}
              onClick={() => {
                void handleLogout()
              }}
            >
              退出登录
            </Button>
          </>
        }
      >
        {notes.hasUnsavedChanges
          ? `当前笔记还有未保存的改动，退出前会先尝试保存；若继续退出，未落盘的改动可能丢失。`
          : `将以 ${user.displayName || user.username} 的身份退出，需要重新登录才能继续编辑。`}
      </Modal>
    </div>
  )
}
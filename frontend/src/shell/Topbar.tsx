import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { IconMenu, IconPanelLeft, IconSearch, IconStar } from '@/components/Icon'
import { SaveStatus } from './SaveStatus'
import { IconContract, IconExpand } from './shellIcons'
import { ThemeMenu } from './ThemeMenu'
import type { Theme } from './theme'
import type { SaveState } from './useNotes'

export interface TopbarProps {
  viewTitle: string
  /** 笔记视图下附带当前笔记标题 */
  noteTitle: string | null
  showSaveStatus: boolean
  saveState: SaveState
  savedAt: number | null
  onRetrySave: () => void
  /** 显式存一个历史版本（自动保存不会产生版本） */
  onSaveVersion?: () => void
  theme: Theme
  /** 主题菜单：四套主题里直接选一套 */
  onSelectTheme: (theme: Theme) => void
  /** 平板/手机：侧栏是抽屉，需要菜单按钮 */
  drawerMode: boolean
  onToggleSidebar: () => void
  /** 手机：搜索框收成图标 */
  compact: boolean
  onSearch: (query: string) => void
  /** 编辑器是否宽屏（占满可用宽度）；≤1023px 不渲染该按钮 */
  editorWide: boolean
  onToggleEditorWidth: () => void
  /** 重命名当前笔记（空/空白标题由外壳兜底）；返回最终标题 */
  onRenameNote?: (next: string) => Promise<unknown> | unknown
  /** 外部请求进入重命名态（笔记项菜单「重命名」）：每 +1 触发一次 */
  renameSignal?: number
  /** 当前笔记是否已收藏（笔记视图下显示 ⭐ 开关） */
  isFavorite?: boolean
  onToggleFavorite?: () => void
}

interface NoteTitleProps {
  title: string
  onRename?: (next: string) => Promise<unknown> | unknown
  renameSignal?: number
}

/** 顶栏笔记标题：点击即变输入框，回车/失焦保存，Esc 取消（唯一显式的改名入口） */
function NoteTitle({ title, onRename, renameSignal }: NoteTitleProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlurRef = useRef(false)
  const lastSignal = useRef(renameSignal ?? 0)

  useEffect(() => {
    if (!editing) setDraft(title)
  }, [title, editing])

  // 外部（笔记项菜单）请求改名：进入编辑态
  useEffect(() => {
    const signal = renameSignal ?? 0
    if (signal !== lastSignal.current) {
      lastSignal.current = signal
      setEditing(true)
    }
  }, [renameSignal])

  useEffect(() => {
    if (!editing) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  const commit = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onRename?.(draft)
    } finally {
      setBusy(false)
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="kb-topbar__subject"
        title="点击修改笔记标题"
        aria-label="重命名笔记"
        data-testid="topbar-note-title"
        onClick={() => setEditing(true)}
      >
        <span className="kb-topbar__subject-text">{title}</span>
        <span className="kb-topbar__subject-pen" aria-hidden="true">
          ✎
        </span>
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      className="kb-topbar__subject kb-topbar__subject--editing"
      aria-label="笔记标题"
      data-testid="topbar-note-title-input"
      value={draft}
      maxLength={512}
      disabled={busy}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          skipBlurRef.current = true
          void commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          skipBlurRef.current = true
          setDraft(title)
          setEditing(false)
        }
      }}
      onBlur={() => {
        if (skipBlurRef.current) {
          skipBlurRef.current = false
          return
        }
        void commit()
      }}
    />
  )
}

export function Topbar({
  viewTitle,
  noteTitle,
  showSaveStatus,
  saveState,
  savedAt,
  onRetrySave,
  onSaveVersion,
  theme,
  onSelectTheme,
  drawerMode,
  onToggleSidebar,
  compact,
  onSearch,
  editorWide,
  onToggleEditorWidth,
  onRenameNote,
  renameSignal,
  isFavorite = false,
  onToggleFavorite,
}: TopbarProps) {
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (compact && searchOpen) inputRef.current?.focus()
  }, [compact, searchOpen])

  const submit = () => {
    const trimmed = query.trim()
    if (!trimmed) return
    onSearch(trimmed)
    setSearchOpen(false)
  }

  const searchField = (
    <form
      className="kb-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <span className="kb-search__icon">
        <IconSearch size={15} />
      </span>
      <input
        ref={inputRef}
        className="kb-search__input"
        type="search"
        value={query}
        placeholder="搜索笔记…"
        aria-label="搜索笔记"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setSearchOpen(false)
        }}
      />
      <button type="submit" className="kb-search__submit" aria-label="搜索">
        搜索
      </button>
    </form>
  )

  return (
    <header className="kb-topbar">
      <Button
        variant="icon"
        className="kb-topbar__menu"
        onClick={onToggleSidebar}
        aria-label={drawerMode ? '打开菜单' : '展开/收起左栏'}
        title={drawerMode ? '打开菜单' : '展开/收起左栏'}
        data-testid="topbar-menu"
      >
        {drawerMode ? <IconMenu size={18} /> : <IconPanelLeft size={18} />}
      </Button>

      <span className="kb-topbar__title">{viewTitle}</span>
      {noteTitle ? (
        <NoteTitle title={noteTitle} onRename={onRenameNote} renameSignal={renameSignal} />
      ) : null}

      <div className="kb-topbar__actions">
        {compact ? null : <div className="kb-topbar__search">{searchField}</div>}

        {compact && !searchOpen ? (
          <Button
            variant="icon"
            onClick={() => setSearchOpen(true)}
            aria-label="打开搜索"
            title="搜索"
            data-testid="topbar-search-toggle"
          >
            <IconSearch size={18} />
          </Button>
        ) : null}

        {showSaveStatus && onToggleFavorite ? (
          <Button
            variant="icon"
            onClick={onToggleFavorite}
            aria-label={isFavorite ? '取消收藏这篇笔记' : '收藏这篇笔记'}
            aria-pressed={isFavorite}
            title={isFavorite ? '取消收藏' : '收藏（收藏不会产生新版本）'}
            data-testid="topbar-favorite"
          >
            <IconStar size={18} />
          </Button>
        ) : null}

        {showSaveStatus ? (
          <>
            <SaveStatus state={saveState} savedAt={savedAt} onRetry={onRetrySave} />
            {onSaveVersion ? (
              <Button
                variant="ghost"
                size="sm"
                className="kb-topbar__version-btn"
                onClick={onSaveVersion}
                aria-label="保存版本"
                title="自动保存不会增加版本号；点这里手动留一个历史版本（Ctrl+S 也可）"
              >
                存为版本
              </Button>
            ) : null}
          </>
        ) : null}

        {/* 编辑器宽度：窄屏（≤1023px）本来就没有留白，按钮不渲染 */}
        {drawerMode ? null : (
          <Button
            variant="icon"
            onClick={onToggleEditorWidth}
            aria-label={editorWide ? '窄栏' : '宽屏'}
            title={editorWide ? '窄栏（860px 居中）' : '宽屏（占满可用宽度）'}
            data-testid="topbar-editor-width"
          >
            {editorWide ? <IconContract size={18} /> : <IconExpand size={18} />}
          </Button>
        )}

        <ThemeMenu theme={theme} onSelect={onSelectTheme} />
      </div>

      {compact && searchOpen ? (
        <div className="kb-topbar__searchrow">{searchField}</div>
      ) : null}
    </header>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { NoteListItem } from '@/api/types'

/** 超过 delay 毫秒才置 true —— 骨架屏用它避免「闪一下」 */
function useDelayedFlag(active: boolean, delay = 500): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!active) {
      setShown(false)
      return
    }
    const timer = window.setTimeout(() => setShown(true), delay)
    return () => window.clearTimeout(timer)
  }, [active, delay])
  return shown
}

const HEADING_LINE = /^\s{0,3}#{1,6}\s+([^\n]*)(?:\n|$)/

/** 列表摘要：剥掉 Markdown 标记，只留纯文本，最多 60 字（后端已按需截断 excerpt） */
export function plainExcerpt(raw: string | null | undefined, title?: string | null): string {
  if (!raw) return ''
  // 正文第一行常常就是笔记标题（H1），列表里已经单独显示过，别再重复一遍
  const heading = HEADING_LINE.exec(raw)
  const headingText = (heading?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const titleText = (title ?? '').replace(/\s+/g, ' ').trim()
  const body = heading && titleText && headingText === titleText ? raw.slice(heading[0].length) : raw
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接 → 文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 标题标记
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // 粗体
    .replace(/(\*|_)(.*?)\1/g, '$2') // 斜体
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1') // 行内代码
    .replace(/^\s*>\s?/gm, '') // 引用
    .replace(/^\s*[-*+]\s+/gm, '') // 列表
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 60 ? text.slice(0, 60) + '…' : text
}
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { IconAlert, IconFileText, IconPlus, IconRefresh, IconStar } from '@/components/Icon'
import { Skeleton } from '@/components/Skeleton'
import { NOTE_DND_TYPE } from './dnd'
import { IconMore } from './shellIcons'
import { formatRelativeTime } from './time'

const MENU_WIDTH = 132
const MENU_HEIGHT = 88

export interface NoteListProps {
  items: NoteListItem[]
  loading: boolean
  error: string | null
  selectedId: number | null
  /** 当前选中的笔记有未保存改动时给出它的 id */
  dirtyNoteId: number | null
  /** 命中全量拉取上限时的提示（不允许静默截断） */
  truncation: { total: number; loaded: number } | null
  onSelect: (id: number) => void
  onRetry: () => void
  onCreate: () => void
  creating: boolean
  /** 删除一篇笔记（外壳负责二次确认 / 调 deleteNote / 切下一篇） */
  onDelete: (id: number) => void
  /** 重命名一篇笔记（外壳负责打开该篇并让顶栏标题进入编辑态） */
  onRename: (id: number) => void
}

interface MenuState {
  id: number
  top: number
  left: number
}

export function NoteList({
  items,
  loading,
  error,
  selectedId,
  dirtyNoteId,
  truncation,
  onSelect,
  onRetry,
  onCreate,
  creating,
  onDelete,
  onRename,
}: NoteListProps) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  /* 菜单打开时：点别处 / Esc / 滚动 / 改窗口大小都关掉。
     注意用 click（不是 mousedown），否则按下菜单项时菜单会先被卸载、点击落空。 */
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      // 「⋯」自己负责开合，不在这里抢
      if (target.closest('.kb-note-item__more')) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const showSkeleton = useDelayedFlag(loading && items.length === 0, 500)

  const openMenu = (item: NoteListItem, anchor: HTMLElement) => {
    if (menu?.id === item.id) {
      setMenu(null)
      return
    }
    const rect = anchor.getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
    const below = rect.bottom + 6
    const top =
      below + MENU_HEIGHT > window.innerHeight ? Math.max(8, rect.top - MENU_HEIGHT - 6) : below
    setMenu({ id: item.id, top, left })
  }

  const menuItem = items.find((item) => item.id === menu?.id) ?? null

  return (
    <div className="kb-note-list-wrap">
      <div className="kb-sidebar__section">
        <span>笔记</span>
        <span className="kb-sidebar__section-actions">
          {!loading ? <span className="kb-sidebar__section-count">{items.length}</span> : null}
          <Button
            variant="icon"
            size="sm"
            loading={creating}
            onClick={onCreate}
            title="新建笔记"
            aria-label="新建笔记"
          >
            <IconPlus size={15} />
          </Button>
        </span>
      </div>

      {truncation ? (
        <p className="kb-note-list__notice" role="status">
          笔记过多，仅加载前 {truncation.loaded} 篇（共 {truncation.total} 篇）
        </p>
      ) : null}

      {error && items.length > 0 ? (
        <p className="kb-note-list__notice kb-note-list__notice--error" role="alert">
          {error}
          <button type="button" className="kb-linkish" onClick={onRetry}>
            重试
          </button>
        </p>
      ) : null}

      {showSkeleton ? (
        <div className="kb-sidebar__skeleton">
          {[0, 1, 2, 3, 4].map((key) => (
            <div className="kb-sidebar__skeleton-row" key={key}>
              <Skeleton width={`${88 - key * 12}%`} height={13} />
              <Skeleton width="42%" height={10} />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        error ? (
          <EmptyState
            icon={<IconAlert size={20} />}
            title="笔记列表加载失败"
            action={
              <Button size="sm" icon={<IconRefresh size={14} />} onClick={onRetry}>
                重试
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<IconFileText size={20} />}
            title="这里还没有笔记"
            desc="点右上角 + 新建一篇"
            action={
              <Button size="sm" icon={<IconPlus size={14} />} onClick={onCreate}>
                新建笔记
              </Button>
            }
          />
        )
      ) : (
        <ul className="kb-note-list">
          {items.map((item) => (
            <li key={item.id}>
              <div
                className={[
                  'kb-note-item',
                  item.id === selectedId ? 'kb-note-item--active' : '',
                  item.id === dirtyNoteId ? 'kb-note-item--dirty' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(NOTE_DND_TYPE, String(item.id))
                  event.dataTransfer.effectAllowed = 'move'
                }}
              >
                {/* 「⋯」在 DOM 里排在主按钮之前，靠 z-index 浮在右侧 */}
                <button
                  type="button"
                  className="kb-note-item__more"
                  aria-label={`「${item.title || '无标题'}」的更多操作`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.id === item.id}
                  title="更多操作"
                  draggable={false}
                  onDragStart={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    openMenu(item, event.currentTarget)
                  }}
                >
                  <IconMore size={16} />
                </button>

                <button
                  type="button"
                  className="kb-note-item__main"
                  onClick={() => onSelect(item.id)}
                  aria-current={item.id === selectedId ? 'true' : undefined}
                  title={`拖到左侧目录可移动：${item.title || '无标题'}`}
                >
                  <span className="kb-note-item__title">
                    {item.isPinned ? <span className="kb-note-item__pin">置顶</span> : null}
                    {item.title || '无标题'}
                  </span>
                  {plainExcerpt(item.excerpt, item.title) ? (
                    <span className="kb-note-item__excerpt">
                      {plainExcerpt(item.excerpt, item.title)}
                    </span>
                  ) : null}
                  <span className="kb-note-item__meta">
                    <span>{formatRelativeTime(item.updatedAt)}</span>
                    {item.isFavorite ? (
                      <span className="kb-note-item__fav" title="已收藏">
                        <IconStar size={12} />
                      </span>
                    ) : null}
                    {item.tags.length > 0 ? <span>#{item.tags[0].name}</span> : null}
                  </span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {menu && menuItem ? (
        <div
          ref={menuRef}
          className="kb-note-menu"
          role="menu"
          aria-label={`「${menuItem.title || '无标题'}」的操作`}
          style={{ top: `${menu.top}px`, left: `${menu.left}px` }}
        >
          <button
            type="button"
            role="menuitem"
            className="kb-note-menu__item"
            onClick={() => {
              setMenu(null)
              onRename(menuItem.id)
            }}
          >
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            className="kb-note-menu__item kb-note-menu__item--danger"
            onClick={() => {
              setMenu(null)
              onDelete(menuItem.id)
            }}
          >
            删除
          </button>
        </div>
      ) : null}
    </div>
  )
}
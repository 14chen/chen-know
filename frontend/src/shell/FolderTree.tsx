import { Fragment, useEffect, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type { FolderNode } from '@/api/types'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import {
  IconAlert,
  IconChevronRight,
  IconFolder,
  IconInbox,
  IconLayers,
  IconPlus,
  IconRefresh,
} from '@/components/Icon'
import { Modal } from '@/components/Modal'
import { Skeleton } from '@/components/Skeleton'
import { TextField } from '@/components/TextField'
import { FOLDER_DND_TYPE, NOTE_DND_TYPE, hasType, readDragId } from './dnd'
import { IconMore } from './shellIcons'
import { countSubtreeNotes } from './useTree'

const EXPANDED_KEY = 'kb.tree.expanded'

/** 行级菜单：fixed 定位，避免被目录树的滚动容器裁掉（高度只用于判断往上翻还是往下翻） */
const MENU_HEIGHT = 120

type TreeMenu = { id: number; node: FolderNode; top: number; right: number }

type DropTarget = { kind: 'root' } | { kind: 'unclassified' } | { kind: 'folder'; node: FolderNode }

type TreeDialog =
  | { kind: 'create'; parentId: number | null }
  | { kind: 'rename'; node: FolderNode }
  | null

function readExpanded(): number[] {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is number => typeof value === 'number' && value > 0)
  } catch {
    return []
  }
}

/** 从根到 id 的祖先路径（不含自身），用于自动展开当前目录 */
function findPath(nodes: FolderNode[], id: number, trail: number[] = []): number[] | null {
  for (const node of nodes) {
    if (node.id === id) return trail
    const hit = findPath(node.children, id, [...trail, node.id])
    if (hit) return hit
  }
  return null
}

export interface FolderTreeProps {
  tree: FolderNode[]
  loading: boolean
  error: string | null
  /** 当前过滤：null=全部笔记；0=未分类；正整数=目录 id */
  activeFilter: number | null
  counts: { all: number; unclassified: number }
  onFilter: (filter: number | null) => void
  onReload: () => void
  onCreate: (parentId: number | null, name: string) => Promise<number | null>
  onRename: (id: number, name: string) => Promise<boolean>
  onMoveFolder: (id: number, parentId: number | null) => void
  onDelete: (node: FolderNode) => void
  onDropNote: (noteId: number, folderId: number | null) => void
}

export function FolderTree({
  tree,
  loading,
  error,
  activeFilter,
  counts,
  onFilter,
  onReload,
  onCreate,
  onRename,
  onMoveFolder,
  onDelete,
  onDropNote,
}: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(readExpanded()))
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [dialog, setDialog] = useState<TreeDialog>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<TreeMenu | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  /* 菜单打开时：点别处 / Esc / 滚动 / 改窗口大小都关掉（与笔记列表的「⋯」同一套规则） */
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      // 「⋯」自己负责开合，不在这里抢
      if (target.closest('.kb-tree-row__more')) return
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

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [expanded])

  /* 拖拽结束（含拖到别处）时清掉高亮 */
  useEffect(() => {
    const clear = () => setDropKey(null)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  /* 选中某目录时，自动展开它的祖先，保证高亮可见 */
  useEffect(() => {
    if (activeFilter === null || activeFilter === 0) return
    const path = findPath(tree, activeFilter)
    if (!path || path.length === 0) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of path) {
        next.add(id)
      }
      return next
    })
  }, [activeFilter, tree])

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openDialog = (next: Exclude<TreeDialog, null>) => {
    setDraft(next.kind === 'rename' ? next.node.name : '')
    setDialog(next)
  }

  const openMenu = (node: FolderNode, anchor: HTMLElement) => {
    if (menu?.id === node.id) {
      setMenu(null)
      return
    }
    // 右边缘贴着「⋯」对齐：菜单宽度由内容决定，用 right 定位就不会差几个像素
    const rect = anchor.getBoundingClientRect()
    const right = Math.max(8, window.innerWidth - rect.right)
    const below = rect.bottom + 6
    const top =
      below + MENU_HEIGHT > window.innerHeight ? Math.max(8, rect.top - MENU_HEIGHT - 6) : below
    setMenu({ id: node.id, node, top, right })
  }

  const submitDialog = async () => {
    if (!dialog) return
    const name = draft.trim()
    if (!name) return

    setBusy(true)
    if (dialog.kind === 'create') {
      const id = await onCreate(dialog.parentId, name)
      if (id !== null && dialog.parentId !== null) {
        setExpanded((prev) => new Set(prev).add(dialog.parentId as number))
      }
      setBusy(false)
      if (id !== null) setDialog(null)
      return
    }

    const ok = await onRename(dialog.node.id, name)
    setBusy(false)
    if (ok) setDialog(null)
  }

  /* ---- 拖拽 ------------------------------------------------------------ */

  const dragOver = (event: DragEvent<HTMLElement>, key: string, accepts: DropTarget['kind']) => {
    const types = event.dataTransfer.types
    const noteLike = hasType(types, NOTE_DND_TYPE)
    const folderLike = hasType(types, FOLDER_DND_TYPE)
    if (!noteLike && !folderLike) return
    // 「未分类」只接受笔记：它不是真实目录，目录没有「未分类」这种归属
    if (folderLike && accepts === 'unclassified') return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropKey !== key) setDropKey(key)
  }

  const dragLeave = (event: DragEvent<HTMLElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    setDropKey(null)
  }

  const drop = (event: DragEvent<HTMLElement>, target: DropTarget) => {
    event.preventDefault()
    setDropKey(null)
    const types = event.dataTransfer.types

    if (hasType(types, NOTE_DND_TYPE)) {
      const noteId = readDragId(event, NOTE_DND_TYPE)
      if (noteId !== null) onDropNote(noteId, target.kind === 'folder' ? target.node.id : null)
      return
    }
    if (hasType(types, FOLDER_DND_TYPE)) {
      if (target.kind === 'unclassified') return
      const folderId = readDragId(event, FOLDER_DND_TYPE)
      if (folderId !== null) {
        onMoveFolder(folderId, target.kind === 'folder' ? target.node.id : null)
      }
    }
  }

  const renderRow = (node: FolderNode, depth: number): ReactNode => {
    const key = `folder:${node.id}`
    const isOpen = expanded.has(node.id)
    const hasChildren = node.children.length > 0
    const active = activeFilter === node.id

    return (
      <Fragment key={node.id}>
        <div
          className={[
            'kb-tree-row',
            active ? 'kb-tree-row--active' : '',
            dropKey === key ? 'kb-tree-row--drop' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: `${depth * 14}px` }}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(FOLDER_DND_TYPE, String(node.id))
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(event) => dragOver(event, key, 'folder')}
          onDragLeave={dragLeave}
          onDrop={(event) => drop(event, { kind: 'folder', node })}
        >
          {hasChildren ? (
            <button
              type="button"
              className={['kb-tree-row__twist', isOpen ? 'kb-tree-row__twist--open' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => toggle(node.id)}
              aria-label={isOpen ? `折叠 ${node.name}` : `展开 ${node.name}`}
              aria-expanded={isOpen}
            >
              <IconChevronRight size={14} />
            </button>
          ) : (
            <span className="kb-tree-row__twist kb-tree-row__twist--leaf" />
          )}

          <button
            type="button"
            className="kb-tree-row__main"
            onClick={() => onFilter(node.id)}
            aria-current={active ? 'true' : undefined}
          >
            <span className="kb-tree-row__icon">
              <IconFolder size={15} />
            </span>
            <span className="kb-tree-row__name" title={node.name}>
              {node.name}
            </span>
          </button>

          {/* 目录树显示整棵子树的笔记数：父目录自己没有直属笔记，显示 0 会让人以为空目录 */}
          <span className="kb-tree-row__count">{countSubtreeNotes(node)}</span>
          <button
            type="button"
            className="kb-tree-row__more"
            aria-label={`「${node.name}」的更多操作`}
            aria-haspopup="menu"
            aria-expanded={menu?.id === node.id}
            title="更多操作"
            draggable={false}
            onDragStart={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              openMenu(node, event.currentTarget)
            }}
          >
            <IconMore size={15} />
          </button>
        </div>

        {hasChildren && isOpen ? (
          <div className="kb-tree__children" role="group">
            {node.children.map((child) => renderRow(child, depth + 1))}
          </div>
        ) : null}
      </Fragment>
    )
  }

  const allKey = 'virtual:all'
  const unclassifiedKey = 'virtual:unclassified'

  return (
    <div className="kb-tree">
      <div className="kb-tree__head">
        <span className="kb-tree__title">目录</span>
        <Button
          variant="icon"
          size="sm"
          onClick={() => openDialog({ kind: 'create', parentId: null })}
          title="新建顶级目录"
          aria-label="新建顶级目录"
        >
          <IconPlus size={15} />
        </Button>
      </div>

      <div className="kb-tree__body">
        <div
          className={[
            'kb-tree-row',
            'kb-tree-row--virtual',
            activeFilter === null ? 'kb-tree-row--active' : '',
            dropKey === allKey ? 'kb-tree-row--drop' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onDragOver={(event) => dragOver(event, allKey, 'root')}
          onDragLeave={dragLeave}
          onDrop={(event) => drop(event, { kind: 'root' })}
        >
          <button type="button" className="kb-tree-row__main" onClick={() => onFilter(null)}>
            <span className="kb-tree-row__icon">
              <IconLayers size={15} />
            </span>
            <span className="kb-tree-row__name">全部笔记</span>
          </button>
          <span className="kb-tree-row__count">{counts.all}</span>
        </div>

        <div
          className={[
            'kb-tree-row',
            'kb-tree-row--virtual',
            activeFilter === 0 ? 'kb-tree-row--active' : '',
            dropKey === unclassifiedKey ? 'kb-tree-row--drop' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onDragOver={(event) => dragOver(event, unclassifiedKey, 'unclassified')}
          onDragLeave={dragLeave}
          onDrop={(event) => drop(event, { kind: 'unclassified' })}
        >
          <button type="button" className="kb-tree-row__main" onClick={() => onFilter(0)}>
            <span className="kb-tree-row__icon">
              <IconInbox size={15} />
            </span>
            <span className="kb-tree-row__name">未分类</span>
          </button>
          <span className="kb-tree-row__count">{counts.unclassified}</span>
        </div>

        {loading && tree.length === 0 ? (
          <div className="kb-tree__skeleton">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} width={`${78 - key * 14}%`} height={13} />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            icon={<IconAlert size={20} />}
            title="目录树加载失败"
            desc={error}
            action={
              <Button size="sm" icon={<IconRefresh size={14} />} onClick={onReload}>
                重试
              </Button>
            }
          />
        ) : tree.length === 0 ? (
          <p className="kb-tree__hint">还没有目录，点上方 + 新建一个。</p>
        ) : (
          tree.map((node) => renderRow(node, 0))
        )}
      </div>

      {menu ? (
        <div
          ref={menuRef}
          className="kb-note-menu"
          role="menu"
          aria-label={`「${menu.node.name}」的目录操作`}
          style={{ top: `${menu.top}px`, right: `${menu.right}px` }}
        >
          <button
            type="button"
            role="menuitem"
            className="kb-note-menu__item"
            aria-label={`在 ${menu.node.name} 下新建子目录`}
            onClick={() => {
              const node = menu.node
              setMenu(null)
              openDialog({ kind: 'create', parentId: node.id })
            }}
          >
            新建子目录
          </button>
          <button
            type="button"
            role="menuitem"
            className="kb-note-menu__item"
            aria-label={`重命名 ${menu.node.name}`}
            onClick={() => {
              const node = menu.node
              setMenu(null)
              openDialog({ kind: 'rename', node })
            }}
          >
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            className="kb-note-menu__item kb-note-menu__item--danger"
            aria-label={`删除 ${menu.node.name}`}
            onClick={() => {
              const node = menu.node
              setMenu(null)
              onDelete(node)
            }}
          >
            删除
          </button>
        </div>
      ) : null}

      <Modal
        open={dialog !== null}
        title={
          dialog?.kind === 'rename'
            ? '重命名目录'
            : dialog?.parentId
              ? '新建子目录'
              : '新建目录'
        }
        onClose={() => {
          if (!busy) setDialog(null)
        }}
        footer={
          <>
            <Button onClick={() => setDialog(null)} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={draft.trim().length === 0}
              onClick={() => {
                void submitDialog()
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <TextField
          label="目录名"
          value={draft}
          autoFocus
          maxLength={120}
          placeholder="例如：技术笔记"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              event.preventDefault()
              void submitDialog()
            }
          }}
        />
      </Modal>
    </div>
  )
}

import { Fragment, useEffect, useState } from 'react'
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
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@/components/Icon'
import { Modal } from '@/components/Modal'
import { Skeleton } from '@/components/Skeleton'
import { TextField } from '@/components/TextField'
import { FOLDER_DND_TYPE, NOTE_DND_TYPE, hasType, readDragId } from './dnd'

const EXPANDED_KEY = 'kb.tree.expanded'

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
            <span className="kb-tree-row__count">{node.noteCount}</span>
          </button>

          <span className="kb-tree-row__actions">
            <button
              type="button"
              className="kb-tree-row__action"
              title={`在「${node.name}」下新建子目录`}
              aria-label={`在 ${node.name} 下新建子目录`}
              onClick={() => openDialog({ kind: 'create', parentId: node.id })}
            >
              <IconPlus size={14} />
            </button>
            <button
              type="button"
              className="kb-tree-row__action"
              title={`重命名「${node.name}」`}
              aria-label={`重命名 ${node.name}`}
              onClick={() => openDialog({ kind: 'rename', node })}
            >
              <IconPencil size={14} />
            </button>
            <button
              type="button"
              className="kb-tree-row__action kb-tree-row__action--danger"
              title={`删除「${node.name}」`}
              aria-label={`删除 ${node.name}`}
              onClick={() => onDelete(node)}
            >
              <IconTrash size={14} />
            </button>
          </span>
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
            <span className="kb-tree-row__count">{counts.all}</span>
          </button>
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
            <span className="kb-tree-row__count">{counts.unclassified}</span>
          </button>
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

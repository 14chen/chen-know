import type { ReactNode } from 'react'
import type { FolderNode, NoteListItem, User } from '@/api/types'
import { Button } from '@/components/Button'
import {
  IconBook,
  IconChart,
  IconClock,
  IconHistory,
  IconLink,
  IconLogOut,
  IconPanelLeft,
  IconSearch,
  IconStar,
  IconTag,
  IconTrash,
  IconUpload,
  IconUsers,
} from '@/components/Icon'
import { VIEW_ENTRIES } from '@/views/registry'
import { FolderTree } from './FolderTree'
import { NoteList } from './NoteList'
import { IconBriefing, IconGraph, IconWeekly } from './shellIcons'

const VIEW_ICONS: Record<string, ReactNode> = {
  search: <IconSearch size={16} />,
  tags: <IconTag size={16} />,
  favorites: <IconStar size={16} />,
  recent: <IconClock size={16} />,
  backlinks: <IconLink size={16} />,
  versions: <IconHistory size={16} />,
  trash: <IconTrash size={16} />,
  io: <IconUpload size={16} />,
  graph: <IconGraph size={16} />,
  weekly: <IconWeekly size={16} />,
  briefing: <IconBriefing size={16} />,
  stats: <IconChart size={16} />,
  admin: <IconUsers size={16} />,
}

export interface SidebarProps {
  user: User
  isAdmin: boolean
  activeViewId: string
  onNavigateView: (viewId: string) => void

  tree: FolderNode[]
  treeLoading: boolean
  treeError: string | null
  onTreeReload: () => void
  folderFilter: number | null
  folderCounts: { all: number; unclassified: number }
  onFolderFilter: (filter: number | null) => void
  onCreateFolder: (parentId: number | null, name: string) => Promise<number | null>
  onRenameFolder: (id: number, name: string) => Promise<boolean>
  onMoveFolder: (id: number, parentId: number | null) => void
  onDeleteFolder: (node: FolderNode) => void
  onDropNote: (noteId: number, folderId: number | null) => void

  notes: NoteListItem[]
  notesLoading: boolean
  notesError: string | null
  notesTruncation: { total: number; loaded: number } | null
  selectedNoteId: number | null
  dirtyNoteId: number | null
  onSelectNote: (id: number) => void
  onReloadNotes: () => void
  onCreateNote: () => void
  creatingNote: boolean
  onDeleteNote: (id: number) => void
  onRenameNote: (id: number) => void

  onCollapse: () => void
  onLogout: () => void
}

export function Sidebar({
  user,
  isAdmin,
  activeViewId,
  onNavigateView,
  tree,
  treeLoading,
  treeError,
  onTreeReload,
  folderFilter,
  folderCounts,
  onFolderFilter,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onDropNote,
  notes,
  notesLoading,
  notesError,
  notesTruncation,
  selectedNoteId,
  dirtyNoteId,
  onSelectNote,
  onReloadNotes,
  onCreateNote,
  creatingNote,
  onDeleteNote,
  onRenameNote,
  onCollapse,
  onLogout,
}: SidebarProps) {
  const initial = (user.displayName || user.username).trim().slice(0, 1)
  const entries = VIEW_ENTRIES.filter((entry) => entry.nav && (!entry.adminOnly || isAdmin))

  return (
    <div className="kb-sidebar__inner">
      <div className="kb-sidebar__head">
        <span className="kb-sidebar__brand">
          <span className="kb-sidebar__brand-icon">
            <IconBook size={15} />
          </span>
          知识库
        </span>
        <Button variant="icon" onClick={onCollapse} aria-label="收起左栏" title="收起左栏">
          <IconPanelLeft size={17} />
        </Button>
      </div>

      <div className="kb-sidebar__user">
        <span className="kb-sidebar__avatar">{initial}</span>
        <span className="kb-sidebar__user-meta">
          <span className="kb-sidebar__user-name">{user.displayName || user.username}</span>
          <span className="kb-sidebar__user-sub">
            @{user.username}
            {user.role === 'admin' ? ' · 管理员' : ''}
          </span>
        </span>
        <Button variant="icon" onClick={onLogout} aria-label="退出登录" title="退出登录">
          <IconLogOut size={17} />
        </Button>
      </div>

      <nav className="kb-nav" aria-label="功能入口">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={[
              'kb-nav__item',
              activeViewId === entry.id ? 'kb-nav__item--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onNavigateView(entry.id)}
            title={entry.title}
            aria-current={activeViewId === entry.id ? 'page' : undefined}
          >
            <span className="kb-nav__icon">{VIEW_ICONS[entry.id]}</span>
            <span className="kb-nav__label">{entry.title}</span>
          </button>
        ))}
      </nav>

      <div className="kb-sidebar__scroll">
        <FolderTree
          tree={tree}
          loading={treeLoading}
          error={treeError}
          activeFilter={folderFilter}
          counts={folderCounts}
          onFilter={onFolderFilter}
          onReload={onTreeReload}
          onCreate={onCreateFolder}
          onRename={onRenameFolder}
          onMoveFolder={onMoveFolder}
          onDelete={onDeleteFolder}
          onDropNote={onDropNote}
        />

        <NoteList
          items={notes}
          loading={notesLoading}
          error={notesError}
          truncation={notesTruncation}
          selectedId={selectedNoteId}
          dirtyNoteId={dirtyNoteId}
          onSelect={onSelectNote}
          onRetry={onReloadNotes}
          onCreate={onCreateNote}
          creating={creatingNote}
          onDelete={onDeleteNote}
        onRename={onRenameNote}
        />
      </div>
    </div>
  )
}

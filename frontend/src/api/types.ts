/**
 * 后端数据形状 —— 与 docs/API.md 冻结契约逐字一致。
 *
 * ⚠️ 这是并行开发的字段名契约。视图实现者只许引用本文件的类型，
 *    不要自己重新声明接口；字段名对不上就是集成失败。
 */

/* ---------------------------------------------------------------- 账号 */

export interface User {
  id: number
  username: string
  displayName: string
  role: 'admin' | 'member'
}

/** 分页信封（API.md §0.3） */
export interface Page<T> {
  items: T[]
  page: number
  size: number
  total: number
}

/* ---------------------------------------------------------------- 笔记 */

export interface NoteTag {
  id: number
  name: string
  color: string
}

/** GET /api/notes 的列表项：**不含 content** */
export interface NoteListItem {
  id: number
  folderId: number | null
  title: string
  excerpt: string
  isFavorite: boolean
  isPinned: boolean
  version: number
  tags: NoteTag[]
  createdAt: string
  updatedAt: string
}

/** GET /api/notes/{id}：列表项 + 正文 */
export interface NoteDetail extends NoteListItem {
  content: string
}

/** PATCH /api/notes/{id}（API.md §4） */
export interface NotePatch {
  folderId?: number | null
  title?: string
  content?: string
  isFavorite?: boolean
  isPinned?: boolean
  sortOrder?: number
  /** false = 自动保存：正文落盘但不新建历史版本、不递增 version（默认 true） */
  createVersion?: boolean
  /** true = 显式「存为版本」：即使内容没变也留一个快照 */
  forceVersion?: boolean
}

export interface CreateNoteRequest {
  folderId?: number | null
  title?: string
  content?: string
}

/* ---------------------------------------------------------------- 目录 */

/** 目录树节点（API.md §3.1）—— noteCount 为**直属**未删除笔记数 */
export interface FolderNode {
  id: number
  parentId: number | null
  name: string
  sortOrder: number
  noteCount: number
  children: FolderNode[]
}

/** `folderId` 参数语义（API.md §3.1）：不传=全部；正整数=该目录直属；0=未分类 */
export type FolderFilter = number | null | undefined

/* ---------------------------------------------------------------- 标签 */

/** GET /api/tags 返回**裸数组**（API.md §4.3），不是分页信封 */
export interface Tag {
  id: number
  name: string
  color: string
  /** 该标签下未删除笔记数 */
  count: number
}

/* ---------------------------------------------------------------- 搜索 */

/** GET /api/search 的命中项（API.md §5） */
export interface SearchHit {
  noteId: number
  title: string
  /** 含 `<em>` 标记，且是**原始中文**（服务端在原文上计算，非 FTS snippet） */
  highlight: string
  score: number
  folderId: number | null
  updatedAt: string
}

/* ---------------------------------------------------------------- 双链 */

/** 出链（API.md §4.1） */
export interface ResolvedLink {
  noteId: number
  title: string
  folderId: number | null
}

export interface LinkView {
  resolved: ResolvedLink[]
  /** **纯字符串数组**：尚未创建的目标标题 */
  dangling: string[]
}

/** 反链（API.md §4） */
export interface BacklinkItem {
  noteId: number
  title: string
  excerpt: string
}

export interface BacklinkView {
  items: BacklinkItem[]
}

/* ---------------------------------------------------------------- 版本 */

/** GET /api/notes/{id}/versions 返回**裸数组**（API.md §4.4） */
export interface VersionSummary {
  version: number
  title: string
  /** **字符数**（码点数），不是字节数 */
  size: number
  createdAt: string
  createdBy: number | null
}

export interface VersionDetail {
  noteId: number
  version: number
  title: string
  content: string
  createdAt: string
}

/* ---------------------------------------------------------------- 回收站 */

/** API.md §8.1 */
export interface TrashNoteItem {
  id: number
  title: string
  folderId: number | null
  /** 原目录名；`null` 表示未分类 */
  folderName: string | null
  deletedAt: string
}

export interface TrashFolderItem {
  id: number
  name: string
  parentId: number | null
  deletedAt: string
  /** 恢复该目录时会**一并恢复**的笔记数（**含子孙**，与目录树里的 noteCount 口径不同） */
  noteCount: number
}

export interface TrashResponse {
  notes: TrashNoteItem[]
  folders: TrashFolderItem[]
}

export interface EmptyTrashResult {
  deletedNotes: number
  deletedFolders: number
}

/* ---------------------------------------------------------------- 统计 */

/** API.md §9 */
export interface DailyCreated {
  date: string
  count: number
}

export interface StatsResponse {
  noteCount: number
  folderCount: number
  tagCount: number
  attachmentCount: number
  totalAttachmentBytes: number
  trashCount: number
  updatedToday: number
  /** 固定 14 天（含今天），无数据日期补 0 */
  dailyCreated: DailyCreated[]
}

/** GET /api/recent（API.md §4.2）—— 时间字段名固定为 viewedAt */
export interface RecentItem {
  noteId: number
  title: string
  folderId: number | null
  excerpt: string
  viewedAt: string
}

export interface RecentResponse {
  items: RecentItem[]
}

/* ---------------------------------------------------------------- 导入导出 */

/** POST /api/import/preview（API.md §10.1） */
export interface ImportPreviewItem {
  title: string
  sourceFile: string
  tags: string[]
  folder: string | null
  sizeBytes: number
}

export interface ImportPreviewResponse {
  items: ImportPreviewItem[]
  total: number
  errors: string[]
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

/* ---------------------------------------------------------------- 附件 */

/** POST /api/attachments 响应 */
export interface Attachment {
  id: number
  url: string
  originalName: string
  mimeType: string
  sizeBytes: number
}

/* ---------------------------------------------------------------- 成员管理 */

/** API.md §2 */
export interface AdminUser {
  id: number
  username: string
  displayName: string
  role: 'admin' | 'member'
  disabled: boolean
  createdAt: string
  spaceId?: number
}

export interface Invite {
  code: string
  createdAt: string
  expiresAt: string | null
  usedBy: number | null
  usedAt: string | null
  /** 服务端计算字段 */
  used: boolean
  /** 服务端计算字段 */
  expired: boolean
}

export interface CreateUserRequest {
  username: string
  displayName: string
  password: string
  role: 'admin' | 'member'
}

export interface UpdateUserRequest {
  displayName?: string
  password?: string
  role?: 'admin' | 'member'
  disabled?: boolean
}

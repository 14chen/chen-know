import { request } from './client'
import type {
  BacklinkView,
  CreateNoteRequest,
  LinkView,
  NoteDetail,
  NoteListItem,
  NotePatch,
  Page,
  SearchHit,
  VersionDetail,
  VersionSummary,
} from './types'

export interface ListNotesParams {
  size?: number
  sort?: 'updated' | 'created' | 'title'
  page?: number
  /** 目录过滤：正整数=该目录直属；0=未分类；不传=不过滤（API.md §3.1） */
  folderId?: number
  signal?: AbortSignal
}

/** GET /api/notes —— 列表项不含正文 */
export function listNotes(params: ListNotesParams = {}): Promise<Page<NoteListItem>> {
  const search = new URLSearchParams()
  search.set('size', String(params.size ?? 200))
  search.set('sort', params.sort ?? 'updated')
  if (params.page !== undefined) search.set('page', String(params.page))
  if (params.folderId !== undefined) search.set('folderId', String(params.folderId))
  return request<Page<NoteListItem>>(`/api/notes?${search.toString()}`, { signal: params.signal })
}

/** GET /api/notes/{id} —— 含 content / tags */
export function getNote(id: number, signal?: AbortSignal): Promise<NoteDetail> {
  return request<NoteDetail>(`/api/notes/${id}`, { signal })
}

/** PATCH /api/notes/{id} —— 仅 content/title 变化才产生历史版本 */
export function patchNote(id: number, patch: NotePatch): Promise<NoteDetail> {
  return request<NoteDetail>(`/api/notes/${id}`, { method: 'PATCH', body: patch })
}

/** POST /api/notes —— 201 */
export function createNote(payload: CreateNoteRequest = {}): Promise<NoteDetail> {
  return request<NoteDetail>('/api/notes', { method: 'POST', body: payload })
}

/** DELETE /api/notes/{id} —— 软删进回收站，204 */
export function deleteNote(id: number): Promise<void> {
  return request<void>(`/api/notes/${id}`, { method: 'DELETE' })
}

/** POST /api/notes/{id}/view —— 记一次浏览（供「最近浏览」视图），204 */
export function recordNoteView(id: number): Promise<void> {
  return request<void>(`/api/notes/${id}/view`, { method: 'POST' })
}

/* ---- 出链 / 反链 -------------------------------------------------------- */

/** GET /api/notes/{id}/links —— dangling 是纯字符串数组 */
export function listLinks(id: number, signal?: AbortSignal): Promise<LinkView> {
  return request<LinkView>(`/api/notes/${id}/links`, { signal })
}

/** GET /api/notes/{id}/backlinks */
export function listBacklinks(id: number, signal?: AbortSignal): Promise<BacklinkView> {
  return request<BacklinkView>(`/api/notes/${id}/backlinks`, { signal })
}

/* ---- 历史版本 ---------------------------------------------------------- */

/** GET /api/notes/{id}/versions —— **裸数组**，倒序 */
export function listVersions(id: number, signal?: AbortSignal): Promise<VersionSummary[]> {
  return request<VersionSummary[]>(`/api/notes/${id}/versions`, { signal })
}

/** GET /api/notes/{id}/versions/{version} —— 传当前版本号返回当前内容 */
export function getVersion(id: number, version: number, signal?: AbortSignal): Promise<VersionDetail> {
  return request<VersionDetail>(`/api/notes/${id}/versions/${version}`, { signal })
}

/** POST /api/notes/{id}/versions/{version}/restore —— 回滚本身也产生一个新版本 */
export function restoreVersion(id: number, version: number): Promise<NoteDetail> {
  return request<NoteDetail>(`/api/notes/${id}/versions/${version}/restore`, { method: 'POST' })
}

/* ---- 搜索 / 收藏 / 最近 -------------------------------------------------- */

export interface SearchParams {
  q: string
  /** 标签名（旧参数，保留兼容；新代码用 tagId） */
  tag?: string
  /** 标签 id */
  tagId?: number
  /** 正整数=该目录**含子目录**；0=未分类；不传=不过滤 */
  folderId?: number
  /** 起始日期 YYYY-MM-DD（含当天） */
  from?: string
  /** 结束日期 YYYY-MM-DD（含当天） */
  to?: string
  /** relevance（默认，bm25）| updated（按更新时间倒序） */
  sort?: 'relevance' | 'updated'
  page?: number
  size?: number
  signal?: AbortSignal
}

/**
 * 搜索命中项 + 后端新增的 `snippet`。
 *
 * `snippet` 是**纯文本 + markdown 粗体**（命中处 `**词**`，两端补 `…`），
 * 与旧的 `highlight`（HTML `<em>`）是两套东西，**不要混用**：
 * 正文摘要只渲染 snippet（按 `**` 切分，绝不 innerHTML），标题继续用 highlight。
 */
export type SearchHitWithSnippet = SearchHit & { snippet?: string | null }

/** GET /api/search —— highlight 含服务端生成的 `<em>`，渲染前必须净化；snippet 是纯文本 */
export function searchNotes(params: SearchParams): Promise<Page<SearchHitWithSnippet>> {
  const search = new URLSearchParams()
  search.set('q', params.q)
  if (params.tag) search.set('tag', params.tag)
  if (params.tagId !== undefined) search.set('tagId', String(params.tagId))
  if (params.folderId !== undefined) search.set('folderId', String(params.folderId))
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  if (params.sort) search.set('sort', params.sort)
  if (params.page !== undefined) search.set('page', String(params.page))
  if (params.size !== undefined) search.set('size', String(params.size))
  return request<Page<SearchHitWithSnippet>>(`/api/search?${search.toString()}`, { signal: params.signal })
}

/** GET /api/search/suggest 的一条联想词 */
export interface SearchSuggestion {
  /** 联想文本（标签名或笔记标题） */
  text: string
  /** 来源：tag（标签）/ title（标题） */
  kind: 'tag' | 'title' | (string & {})
}

/**
 * GET /api/search/suggest?q=&limit= —— 搜索联想词。
 * q 为空 → 空数组；后端对 q 截断 50 字、limit 默认 5 上限 10。
 */
export function searchSuggest(
  q: string,
  params: { limit?: number; signal?: AbortSignal } = {},
): Promise<{ items: SearchSuggestion[] }> {
  const search = new URLSearchParams()
  search.set('q', q)
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  return request<{ items: SearchSuggestion[] }>(`/api/search/suggest?${search.toString()}`, {
    signal: params.signal,
  })
}

/** GET /api/favorites —— 分页信封，元素同笔记列表项 */
export function listFavorites(
  params: { page?: number; size?: number; signal?: AbortSignal } = {},
): Promise<Page<NoteListItem>> {
  const search = new URLSearchParams()
  if (params.page !== undefined) search.set('page', String(params.page))
  if (params.size !== undefined) search.set('size', String(params.size))
  const query = search.toString()
  return request<Page<NoteListItem>>(`/api/favorites${query ? `?${query}` : ''}`, {
    signal: params.signal,
  })
}

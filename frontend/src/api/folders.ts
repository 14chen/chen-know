import { request } from './client'
import type { FolderNode } from './types'

/** POST /api/folders 请求体：parentId=null 表示建在根 */
export interface CreateFolderRequest {
  parentId: number | null
  name: string
}

/** PATCH /api/folders/{id}：只传要改的字段（空对象会被后端拒绝，400） */
export interface FolderPatch {
  name?: string
  parentId?: number | null
  sortOrder?: number
}

/** GET /api/folders?tree=true —— 嵌套目录树，noteCount 为**直属**未删除笔记数 */
export function listFolders(signal?: AbortSignal): Promise<FolderNode[]> {
  return request<FolderNode[]>('/api/folders?tree=true', { signal })
}

/** POST /api/folders —— 201 */
export function createFolder(payload: CreateFolderRequest): Promise<FolderNode> {
  return request<FolderNode>('/api/folders', { method: 'POST', body: payload })
}

/** PATCH /api/folders/{id} —— 把目录移进自己的子孙会被后端拒绝（400） */
export function patchFolder(id: number, patch: FolderPatch): Promise<FolderNode> {
  return request<FolderNode>(`/api/folders/${id}`, { method: 'PATCH', body: patch })
}

/** DELETE /api/folders/{id} —— 软删该目录 + 全部子孙 + 其中笔记，204 */
export function deleteFolder(id: number): Promise<void> {
  return request<void>(`/api/folders/${id}`, { method: 'DELETE' })
}

import { request } from './client'
import type { Attachment } from './types'

/** GET /api/attachments/health —— 附件体检（断链 / 孤儿） */
export interface AttachmentMissingItem {
  id: number
  noteId: number
  noteTitle: string
  originalName: string
  sizeBytes: number
}

export interface AttachmentHealth {
  total: number
  ok: number
  missing: number
  missingItems: AttachmentMissingItem[]
  orphans: AttachmentMissingItem[]
}

export function getAttachmentHealth(signal?: AbortSignal): Promise<AttachmentHealth> {
  return request<AttachmentHealth>('/api/attachments/health', { signal })
}

/** POST /api/attachments —— multipart 字段名 file，noteId 可选 */
export function uploadAttachment(file: File, noteId?: number): Promise<Attachment> {
  const form = new FormData()
  form.append('file', file)
  if (noteId !== undefined) form.append('noteId', String(noteId))
  return request<Attachment>('/api/attachments', { method: 'POST', formData: form })
}

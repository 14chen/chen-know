/**
 * 拖拽载荷类型。dataTransfer 的格式名会被浏览器规范化为小写。
 */
import type { DragEvent } from 'react'

export const NOTE_DND_TYPE = 'application/x-kb-note'
export const FOLDER_DND_TYPE = 'application/x-kb-folder'

/** dragover 阶段读不到 data，只能看 types —— 因此用它可以判断拖的是什么 */
export function hasType(types: readonly string[], type: string): boolean {
  return types.some((item) => item.toLowerCase() === type)
}

export function readDragId(event: DragEvent<HTMLElement>, type: string): number | null {
  const raw = event.dataTransfer.getData(type) || event.dataTransfer.getData('text/plain')
  const id = Number(raw)
  return Number.isFinite(id) && id > 0 ? id : null
}

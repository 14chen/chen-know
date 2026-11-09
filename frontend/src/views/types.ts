/**
 * 视图模块的冻结接口（本文件由 Lead 维护，实现者不要修改）。
 *
 * 外壳通过 ctx 把能力递给视图；视图只依赖本文件与 `@/api/types`，
 * 不直接触碰 `@/shell/**`，这样两边可以并行开发而不互相阻塞。
 */

import type { ComponentType, ReactNode } from 'react'
import type { FolderNode, NoteListItem, User } from '@/api/types'

export interface ToastApi {
  info(message: string): void
  success(message: string): void
  error(message: string): void
  warn(message: string): void
}

export interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmText?: string
  cancelText?: string
  /** 危险操作：确认按钮用红色 */
  danger?: boolean
}

/** 外壳提供给每个视图的上下文 */
export interface ViewContext {
  /* ---- 身份 ---- */
  user: User
  isAdmin: boolean

  /* ---- 路由 ---- */
  /**
   * 跳转到视图。`navigate('search', { q: '天气' })` → `#/search?q=天气`
   * `navigate('notes', { id: 12 })` → `#/notes/12`
   */
  navigate(view: string, params?: Record<string, string | number | null | undefined>): void
  /** 当前路由的查询参数（字符串形式） */
  params: Record<string, string>

  /* ---- 反馈 ---- */
  toast: ToastApi
  /** Promise 化的确认框；用户取消返回 false。**不要用原生 confirm()** */
  confirm(options: ConfirmOptions): Promise<boolean>

  /* ---- 笔记联动 ---- */
  /** 打开一篇笔记（会先落盘未保存的改动，然后切到笔记视图） */
  openNote(id: number): void
  /** 当前打开的笔记 id，未打开为 null */
  currentNoteId: number | null
  /** 笔记列表（含 tags / isPinned），视图做「选择笔记」类控件时复用 */
  notes: NoteListItem[]
  /** 全部笔记标题，供 [[双链]] 补全与「已存在 / 未创建」判定 */
  knownTitles: string[]
  /** 让外壳重新拉取笔记列表 */
  refreshNotes(): Promise<void>
  /** 让外壳重新拉取目录树 */
  refreshTree(): Promise<void>
  /**
   * 重新加载**当前打开的笔记**（含正文），并保留未保存改动的安全语义。
   * 用途：历史版本回滚、导入覆盖、外部改动后同步编辑器 —— 
   * 只调 refreshNotes() 不会更新编辑器里的正文。
   * 当前没有打开笔记时是 no-op。
   */
  reloadCurrentNote(): Promise<void>
  /** 目录树快照（只读；外壳负责刷新） */
  tree: FolderNode[]

  /* ---- 通用工具（外壳已实现，视图不要重复造） ---- */
  /** 相对时间：刚刚 / 5 分钟前 / 3 天前 */
  relativeTime(iso: string): string
  /** 绝对时间：2026-10-16 16:45 */
  formatDate(iso: string): string
  /** 字节数格式化：1.2 KB / 5.0 MB */
  formatBytes(bytes: number): string
}

export interface ViewProps {
  ctx: ViewContext
}

export interface ViewDefinition {
  /** 路由名，必须与 `#/xxx` 中的 xxx 一致 */
  id: string
  /** 顶栏显示的名称 */
  title: string
  /** true 时仅管理员可见（成员访问会被外壳拦下） */
  adminOnly?: boolean
  /** 主区域渲染的组件 */
  component: ComponentType<ViewProps>
}

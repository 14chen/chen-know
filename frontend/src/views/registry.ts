/**
 * 视图注册表（本文件所有者：f-shell）。
 *
 * 设计要点（FULL.md §2）：
 * 1. 路由名 `id` 必须与 `#/<id>` 一致；侧栏功能入口由 `VIEW_ENTRIES` 生成，
 *    `adminOnly` 的项对成员隐藏，成员直接访问时由外壳拦下。
 * 2. 视图组件用 `import.meta.glob` **惰性 + 容错**加载：
 *    - 文件尚未落地 → 该视图渲染「此视图加载失败 + 重试」，其余页面不受影响；
 *    - 模块 import 抛错 / 默认导出缺失 / 渲染期抛错 → 同一降级 UI，**绝不白屏**;
 *    - glob 不匹配不会让 build 失败，两位视图实现者可以随时插入文件。
 * 3. **文件路径约定（唯一推荐写法）**：`src/views/<id>/index.tsx`，默认导出
 *    `({ ctx }: ViewProps) => JSX`。兜底解析顺序（仅为兼容）：
 *    `index.tsx` → 该目录下唯一的 `.tsx` → `<id>.tsx`。
 *    视图目录下请只放一个 `.tsx`（子组件放子目录），否则解析歧义 = 加载失败。
 */

import { createElement, useEffect, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { IconAlert } from '@/components/Icon'
import { NotesSlotView } from '@/shell/editorSlot'
import type { ViewDefinition, ViewProps } from './types'

export interface ViewEntry {
  id: string
  title: string
  adminOnly?: boolean
  /** 是否出现在侧栏「功能入口」区；笔记视图由侧栏的目录树+列表本身承载，故为 false */
  nav: boolean
}

/** 侧栏顺序即此数组顺序（FULL.md §1 的 11 个视图 + 后加的 AI 简报，共 12 个，一个不少） */
export const VIEW_ENTRIES: readonly ViewEntry[] = [
  { id: 'notes', title: '笔记', nav: false },
  { id: 'search', title: '搜索', nav: true },
  { id: 'tags', title: '标签', nav: true },
  { id: 'favorites', title: '收藏', nav: true },
  { id: 'recent', title: '最近浏览', nav: true },
  { id: 'backlinks', title: '反链', nav: true },
  { id: 'graph', title: '关系图', nav: true },
  { id: 'versions', title: '历史版本', nav: true },
  { id: 'trash', title: '回收站', nav: true },
  { id: 'io', title: '导入导出', nav: true },
  { id: 'briefing', title: 'AI 简报', nav: true },
  { id: 'weekly', title: '开源周报', nav: true },
  { id: 'stats', title: '统计', nav: true },
  { id: 'admin', title: '成员管理', adminOnly: true, nav: true },
]

/* ---------------------------------------------------------------- 加载器 */

type ViewModuleLoader = () => Promise<unknown>

const MODULES: Record<string, ViewModuleLoader> = import.meta.glob('./*/*.tsx')

function resolveLoader(id: string): ViewModuleLoader | null {
  const prefix = `./${id}/`
  const keys = Object.keys(MODULES).filter((key) => key.startsWith(prefix))
  if (keys.length === 0) return null

  const index = keys.find((key) => key === `${prefix}index.tsx`)
  if (index) return MODULES[index]

  const named = keys.find(
    (key) => key.slice(prefix.length).toLowerCase() === `${id.toLowerCase()}.tsx`,
  )
  if (named) return MODULES[named]

  return keys.length === 1 ? MODULES[keys[0]] : null
}

function describeFailure(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return '未知错误'
}

function renderFailure(title: string, message: string, onRetry: () => void): ReactNode {
  return createElement(
    'div',
    { className: 'kb-view-fallback' },
    createElement(EmptyState, {
      icon: createElement(IconAlert, { size: 22 }),
      title,
      desc: message,
      action: createElement(Button, { size: 'sm', onClick: onRetry }, '重试'),
    }),
  )
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; Component: ComponentType<ViewProps> }
  | { status: 'failed'; title: string; message: string }

function makeLazyView(id: string, title: string): ComponentType<ViewProps> {
  function LazyView(props: ViewProps) {
    const [state, setState] = useState<LoadState>({ status: 'loading' })
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
      let alive = true
      const loader = resolveLoader(id)
      if (!loader) {
        setState({
          status: 'failed',
          title: '此视图尚未就绪',
          message: `找不到 src/views/${id}/index.tsx（模块路径约定见 registry.ts 顶部注释）。`,
        })
        return
      }

      setState({ status: 'loading' })
      loader().then(
        (module) => {
          if (!alive) return
          const candidate = (module as { default?: unknown } | undefined)?.default
          if (typeof candidate !== 'function') {
            setState({
              status: 'failed',
              title: '此视图加载失败',
              message: `src/views/${id}/index.tsx 没有默认导出组件。`,
            })
            return
          }
          setState({ status: 'ready', Component: candidate as ComponentType<ViewProps> })
        },
        (error: unknown) => {
          if (!alive) return
          setState({ status: 'failed', title: '此视图加载失败', message: describeFailure(error) })
        },
      )

      return () => {
        alive = false
      }
    }, [attempt])

    const retry = () => setAttempt((value) => value + 1)

    if (state.status === 'loading') {
      return createElement('div', { className: 'kb-view-loading', role: 'status' }, '正在加载视图…')
    }
    if (state.status === 'failed') {
      return renderFailure(`${state.title}（${title}）`, state.message, retry)
    }

    const { Component } = state
    return createElement(
      ErrorBoundary,
      {
        // 重试时用新的 key 强制重新挂载，避免残留的错误状态
        resetKey: `${id}:${attempt}`,
        fallback: (error: Error, reset: () => void) =>
          renderFailure(`${title}视图渲染失败`, describeFailure(error), reset),
        children: createElement(Component, props),
      },
    )
  }

  LazyView.displayName = `LazyView(${id})`
  return LazyView
}

/* ---------------------------------------------------------------- 导出 */

/** 注册表：`{ id, title, adminOnly?, component }`（FULL.md §2 冻结形状） */
export const VIEWS: ViewDefinition[] = VIEW_ENTRIES.map((entry) => ({
  id: entry.id,
  title: entry.title,
  ...(entry.adminOnly ? { adminOnly: true } : {}),
  component:
    entry.id === 'notes'
      ? (NotesSlotView as ComponentType<ViewProps>)
      : makeLazyView(entry.id, entry.title),
}))

export function findView(id: string): ViewDefinition | undefined {
  return VIEWS.find((view) => view.id === id)
}

export function findEntry(id: string): ViewEntry | undefined {
  return VIEW_ENTRIES.find((entry) => entry.id === id)
}

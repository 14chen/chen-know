import { useCallback, useEffect, useState } from 'react'

/**
 * 全量路由：`#/<view>[/<id>][?k=v]`（FULL.md §2）。
 *
 *   #/notes/12          → { view: 'notes', id: '12', params: {} }
 *   #/search?q=天气     → { view: 'search', id: null, params: { q: '天气' } }
 *   #/             / '' → { view: '', id: null, params: {} }（缺省，由外壳回落到笔记视图）
 */
export interface RouteLocation {
  /** 视图名，与 views/registry.ts 的 id 对应；缺省路由为 '' */
  view: string
  /** 路径第二段（通常是笔记 id）；没有则为 null */
  id: string | null
  /** 查询参数（字符串形式，值已解码） */
  params: Record<string, string>
}

/** 路由可能被外部工具截断，解码失败时退回原串而不是抛错 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseHash(hash: string): RouteLocation {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const queryAt = raw.indexOf('?')
  const path = queryAt === -1 ? raw : raw.slice(0, queryAt)
  const query = queryAt === -1 ? '' : raw.slice(queryAt + 1)

  const segments = path.split('/').filter((segment) => segment.length > 0)

  const params: Record<string, string> = {}
  if (query) {
    new URLSearchParams(query).forEach((value, key) => {
      params[key] = value
    })
  }

  return {
    view: segments.length > 0 ? safeDecode(segments[0]) : '',
    id: segments.length > 1 ? safeDecode(segments[1]) : null,
    params,
  }
}

/** `id` 走路径段，其余键值走查询串；null/undefined/空串的键被跳过 */
export function buildHash(
  view: string,
  params?: Record<string, string | number | null | undefined>,
): string {
  const id = params?.id
  const path = `/${view}${id === null || id === undefined || id === '' ? '' : `/${encodeURIComponent(String(id))}`}`
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (key === 'id') continue
    if (value === null || value === undefined || value === '') continue
    query.set(key, String(value))
  }
  const search = query.toString()
  return `#${path}${search ? `?${search}` : ''}`
}

export interface HashRouter {
  route: RouteLocation
  /** 跳转视图；`navigate('notes', { id: 12 })` → `#/notes/12` */
  navigate: (view: string, params?: Record<string, string | number | null | undefined>) => void
  /** 直接落到某个 hash（用于回退/替换） */
  setHash: (hash: string) => void
}

export function useHashRoute(): HashRouter {
  const [route, setRoute] = useState<RouteLocation>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const setHash = useCallback((hash: string) => {
    if (window.location.hash === hash) {
      // hash 未变化不会触发 hashchange，手动同步一次
      setRoute(parseHash(hash))
      return
    }
    window.location.hash = hash
  }, [])

  const navigate = useCallback(
    (view: string, params?: Record<string, string | number | null | undefined>) => {
      setHash(buildHash(view, params))
    },
    [setHash],
  )

  return { route, navigate, setHash }
}

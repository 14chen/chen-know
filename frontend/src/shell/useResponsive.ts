import { useEffect, useState } from 'react'

/**
 * 四断点体系（FULL.md §4）：
 *   桌面 ≥1280 / 笔记本 1024–1279 / 平板 768–1023 / 手机 <768
 * 平板起侧栏变抽屉，手机单栏且抽屉全宽。
 */
export type Breakpoint = 'desktop' | 'laptop' | 'tablet' | 'phone'

const QUERIES: Record<Breakpoint, string> = {
  desktop: '(min-width: 1280px)',
  laptop: '(min-width: 1024px) and (max-width: 1279px)',
  tablet: '(min-width: 768px) and (max-width: 1023px)',
  phone: '(max-width: 767px)',
}

/** 抽屉模式（平板 + 手机）：侧栏脱离文档流、默认收起、由遮罩关闭 */
export const DRAWER_QUERY = '(max-width: 1023px)'
/** 触摸设备：可点区域 ≥44×44px */
export const COARSE_QUERY = '(pointer: coarse)'

const ORDER: Breakpoint[] = ['desktop', 'laptop', 'tablet', 'phone']

export function currentBreakpoint(): Breakpoint {
  for (const name of ORDER) {
    if (window.matchMedia(QUERIES[name]).matches) return name
  }
  return 'phone'
}

export function isDrawerBreakpoint(breakpoint: Breakpoint): boolean {
  return breakpoint === 'tablet' || breakpoint === 'phone'
}

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(currentBreakpoint)

  useEffect(() => {
    const lists = ORDER.map((name) => window.matchMedia(QUERIES[name]))
    const onChange = () => setBreakpoint(currentBreakpoint())
    lists.forEach((list) => list.addEventListener('change', onChange))
    onChange()
    return () => lists.forEach((list) => list.removeEventListener('change', onChange))
  }, [])

  return breakpoint
}

/** 通用媒体查询订阅（触摸设备判定等） */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    list.addEventListener('change', onChange)
    setMatches(list.matches)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}

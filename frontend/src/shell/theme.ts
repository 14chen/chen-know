import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

/** 与旧版应用共用的 localStorage 键（旧版 store.js：PREFIX='kb.' + 'theme'） */
export const THEME_STORAGE_KEY = 'kb.theme'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 读取已保存的主题。旧版用 JSON.stringify 存值（`"dark"`），
 * 这里裸字符串与 JSON 字符串都接受，避免两版互相读不懂。
 */
export function readStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return null
    let value: unknown = raw
    try {
      value = JSON.parse(raw)
    } catch {
      /* 裸字符串（非旧版写法）直接使用 */
    }
    return value === 'dark' || value === 'light' ? value : null
  } catch {
    return null
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    // 保持与旧版一致的 JSON 形态，两版切换主题时观感一致
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme))
  } catch {
    /* 隐私模式或被禁用：忽略 */
  }
}

export interface ThemeController {
  theme: Theme
  toggleTheme: () => void
}

/** 首次访问跟随系统；显式切换后才落盘（并从此不再跟随系统） */
export function useTheme(): ThemeController {
  const [state, setState] = useState<{ theme: Theme; userSet: boolean }>(() => {
    const stored = readStoredTheme()
    return { theme: stored ?? systemTheme(), userSet: stored !== null }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme)
  }, [state.theme])

  useEffect(() => {
    if (state.userSet) return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => {
      setState({ theme: event.matches ? 'dark' : 'light', userSet: false })
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [state.userSet])

  const toggleTheme = useCallback(() => {
    setState((prev) => {
      const next: Theme = prev.theme === 'dark' ? 'light' : 'dark'
      writeStoredTheme(next)
      return { theme: next, userSet: true }
    })
  }, [])

  return { theme: state.theme, toggleTheme }
}

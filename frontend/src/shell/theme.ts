import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'paper' | 'midnight'

/** 与旧版应用共用的 localStorage 键（旧版 store.js：PREFIX='kb.' + 'theme'） */
export const THEME_STORAGE_KEY = 'kb.theme'

export interface ThemeOption {
  id: Theme
  label: string
  /** 菜单里的一句话气质说明 */
  hint: string
  /** CodeMirror 的 dark 标志 / 系统色适配都看这个 */
  dark: boolean
  /** 与 tokens.css 对应主题块的 --bg、--surface、--accent 一致，只用于菜单色卡 */
  swatch: [string, string, string]
}

export const THEMES: readonly ThemeOption[] = [
  {
    id: 'light',
    label: '明亮',
    hint: '白底紫调，默认',
    dark: false,
    swatch: ['#f6f7f9', '#ffffff', '#4f46e5'],
  },
  {
    id: 'dark',
    label: '深色',
    hint: '夜间护眼',
    dark: true,
    swatch: ['#101216', '#171a20', '#8b93f8'],
  },
  {
    id: 'paper',
    label: '纸张',
    hint: '暖白纸感，长文不刺眼',
    dark: false,
    swatch: ['#f4efe6', '#fdfaf3', '#8f4a1b'],
  },
  {
    id: 'midnight',
    label: '墨夜',
    hint: '青墨低亮，久看不累',
    dark: true,
    swatch: ['#0b1114', '#0f171b', '#5eead4'],
  },
]

const THEME_IDS: string[] = THEMES.map((item) => item.id)

export function isThemeId(value: unknown): value is Theme {
  return typeof value === 'string' && THEME_IDS.includes(value)
}

export function isDarkTheme(theme: Theme): boolean {
  return theme === 'dark' || theme === 'midnight'
}

export function themeOption(theme: Theme): ThemeOption {
  return THEMES.find((item) => item.id === theme) ?? THEMES[0]
}

/** 主题顺序里的下一套（登录页与左栏收起态的「切换主题」按钮用） */
export function nextTheme(theme: Theme): Theme {
  const index = THEME_IDS.indexOf(theme)
  return THEMES[(index + 1) % THEMES.length].id
}

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
    return isThemeId(value) ? value : null
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
  /** 指定一套主题（主题选择菜单用） */
  setTheme: (theme: Theme) => void
  /** 顺次切到下一套（登录页、左栏收起态的一键按钮用） */
  cycleTheme: () => void
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

  const setTheme = useCallback((next: Theme) => {
    writeStoredTheme(next)
    setState({ theme: next, userSet: true })
  }, [])

  const cycleTheme = useCallback(() => {
    setState((prev) => {
      const next = nextTheme(prev.theme)
      writeStoredTheme(next)
      return { theme: next, userSet: true }
    })
  }, [])

  return { theme: state.theme, setTheme, cycleTheme }
}

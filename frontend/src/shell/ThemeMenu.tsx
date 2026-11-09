import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { IconCheck } from '@/components/Icon'
import { IconPalette } from './shellIcons'
import { THEMES, themeOption } from './theme'
import type { Theme } from './theme'

export interface ThemeMenuProps {
  theme: Theme
  onSelect: (theme: Theme) => void
  /** 左栏收起态的窄条里：菜单向右展开，而不是向下 */
  rail?: boolean
}

/**
 * 主题选择：一个调色板图标 + 四套主题的色卡菜单。
 * 不用原生 select，因为要同时展示配色预览、名字与一句气质说明。
 */
export function ThemeMenu({ theme, onSelect, rail = false }: ThemeMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const current = themeOption(theme)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      wrapRef.current?.querySelector<HTMLButtonElement>('.kb-theme__trigger')?.focus()
    }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    // 打开后把焦点送到当前主题上：键盘用户 Tab 进来就能直接换
    const items = wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    const active = wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
    ;(active ?? items?.[0])?.focus()
  }, [open])

  const move = (delta: number) => {
    const items = Array.from(
      wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    )
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = index < 0 ? 0 : (index + delta + items.length) % items.length
    items[next].focus()
  }

  return (
    <div className={['kb-theme', rail ? 'kb-theme--rail' : ''].filter(Boolean).join(' ')} ref={wrapRef}>
      <Button
        variant="icon"
        className="kb-theme__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`主题（当前：${current.label}）`}
        title={`主题：${current.label}`}
        data-testid="topbar-theme"
        onClick={() => setOpen((value) => !value)}
      >
        <IconPalette size={18} />
      </Button>

      {open ? (
        <div
          className="kb-theme__menu"
          role="menu"
          aria-label="选择主题"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              move(-1)
            }
          }}
        >
          {THEMES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === theme}
              className="kb-theme__item"
              onClick={() => {
                onSelect(option.id)
                setOpen(false)
              }}
            >
              <span className="kb-theme__swatch" aria-hidden="true">
                {option.swatch.map((color) => (
                  <span key={color} style={{ background: color }} />
                ))}
              </span>
              <span className="kb-theme__labels">
                <span className="kb-theme__label">{option.label}</span>
                <span className="kb-theme__hint">{option.hint}</span>
              </span>
              {option.id === theme ? (
                <span className="kb-theme__check" aria-hidden="true">
                  <IconCheck size={15} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

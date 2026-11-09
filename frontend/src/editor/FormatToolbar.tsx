/**
 * 选区浮层格式工具栏（docs/EDITOR-FORMAT.md §4）。
 *
 * - 选中非空文本时出现在**选区上方**；顶部空间不足则翻到下方；左右夹紧不溢出。
 * - `pointer: coarse`（触摸设备）改为**固定在视口底部**，按钮 ≥44×44（样式在 editor.css）。
 * - 所有按钮 `mousedown` 都 preventDefault —— **点按钮不会丢编辑器选区**。
 * - 颜色按钮点开是固定调色板下拉（色值来自 format.ts 常量，不做自由取色）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { BG_COLORS, TEXT_COLORS, type ColorProp } from './format'

export type FormatId =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'underline'
  | 'highlight'
  | 'color'
  | 'bg'
  | 'code'
  | 'link'
  | 'clear'

export interface ToolbarState {
  /** 选区顶边（视口坐标，用于放在上方） */
  top: number
  /** 选区底边（用于翻到下方） */
  bottom: number
  /** 选区水平中心（用于对齐） */
  centerX: number
  /** 触摸设备：忽略坐标，固定在底部 */
  coarse: boolean
  /** 当前选中文本已生效的格式 id */
  active: FormatId[]
  /** 当前文字色 / 背景色（若有） */
  color?: string
  bg?: string
}

interface Props {
  state: ToolbarState
  onFormat: (id: FormatId) => void
  onColor: (prop: ColorProp, value: string) => void
}

const GAP = 8
const MARGIN = 8

const ICONS: Record<FormatId, string> = {
  bold: 'B',
  italic: 'I',
  strike: 'S',
  underline: 'U',
  highlight: 'A',
  color: 'A',
  bg: 'A',
  code: '</>',
  link: '',
  clear: '',
}

const BUTTONS: { id: FormatId; label: string; shortcut?: string }[] = [
  { id: 'bold', label: '加粗', shortcut: 'Ctrl+B' },
  { id: 'italic', label: '斜体', shortcut: 'Ctrl+I' },
  { id: 'strike', label: '删除线' },
  { id: 'underline', label: '下划线', shortcut: 'Ctrl+U' },
  { id: 'highlight', label: '高亮' },
  { id: 'color', label: '文字颜色' },
  { id: 'bg', label: '背景颜色' },
  { id: 'code', label: '行内代码', shortcut: 'Ctrl+E' },
  { id: 'link', label: '链接', shortcut: 'Ctrl+K' },
  { id: 'clear', label: '清除格式' },
]

const ICON_SVG: Partial<Record<FormatId, string>> = {
  link: 'M6.5 9.5 9.5 6.5M7.2 4.6l1.6-1.6a3 3 0 0 1 4.2 4.2l-1.6 1.6M8.8 11.4l-1.6 1.6a3 3 0 0 1-4.2-4.2l1.6-1.6',
  clear: 'M4 13.5h8M5.6 10.9 3.3 8.6a1.4 1.4 0 0 1 0-2l4.2-4.2a1.4 1.4 0 0 1 2 0l2.3 2.3a1.4 1.4 0 0 1 0 2l-5 5z',
}

function Icon({ id, color, bg }: { id: FormatId; color?: string; bg?: string }) {
  if (id === 'link' || id === 'clear') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="kb-fmt-svg">
        <path d={ICON_SVG[id]} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (id === 'color') {
    return (
      <span className="kb-ico kb-ico-color" aria-hidden="true">
        A<i style={{ background: color ?? 'currentColor' }} />
      </span>
    )
  }
  if (id === 'bg') {
    return (
      <span className="kb-ico kb-ico-bg" aria-hidden="true">
        <i style={{ background: bg ?? 'transparent' }} />
      </span>
    )
  }
  return (
    <span className={`kb-ico kb-ico-${id}`} aria-hidden="true">
      {ICONS[id]}
    </span>
  )
}

export function FormatToolbar({ state, onFormat, onColor }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [open, setOpen] = useState<'color' | 'bg' | null>(null)

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (Math.abs(r.width - size.w) > 0.5 || Math.abs(r.height - size.h) > 0.5) {
      setSize({ w: r.width, h: r.height })
    }
  })

  // 点外部 / Esc 收起调色板
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // 选区变化后调色板失效，收起
  useEffect(() => {
    setOpen(null)
  }, [state.top, state.bottom, state.active.length])

  const w = size.w || 430
  const h = size.h || 40
  const above = state.top - h - GAP >= MARGIN
  const top = above ? state.top - h - GAP : state.bottom + GAP
  const left = Math.min(Math.max(state.centerX - w / 2, MARGIN), Math.max(MARGIN, window.innerWidth - MARGIN - w))

  const style: React.CSSProperties = state.coarse ? {} : { top, left }

  const palette = open === 'color' ? TEXT_COLORS : open === 'bg' ? BG_COLORS : null

  return (
    <div
      ref={rootRef}
      className={`kb-fmt-toolbar${state.coarse ? ' kb-fmt-coarse' : ''}${above ? '' : ' kb-fmt-below'}`}
      style={style}
      role="toolbar"
      aria-label="文字格式"
      data-placement={above ? 'above' : 'below'}
      onMouseDown={(e) => e.preventDefault()}
    >
      {BUTTONS.map((b) => {
        const isColor = b.id === 'color' || b.id === 'bg'
        const isOn = state.active.includes(b.id) || (b.id === 'color' && !!state.color) || (b.id === 'bg' && !!state.bg)
        const selectedColor = b.id === 'color' ? state.color : b.id === 'bg' ? state.bg : undefined
        return (
          <button
            key={b.id}
            type="button"
            className={`kb-fmt-btn${isOn ? ' is-on' : ''}${isColor ? ' has-caret' : ''}`}
            aria-label={b.shortcut ? `${b.label} (${b.shortcut})` : b.label}
            aria-pressed={isOn}
            aria-expanded={isColor ? open === b.id : undefined}
            title={b.shortcut ? `${b.label} (${b.shortcut})` : b.label}
            data-format={b.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault()
              if (isColor) {
                setOpen(open === b.id ? null : (b.id as 'color' | 'bg'))
                return
              }
              onFormat(b.id)
            }}
          >
            <Icon id={b.id} color={selectedColor} bg={selectedColor} />
            {isColor && <span className="kb-fmt-caret" aria-hidden="true" />}
          </button>
        )
      })}

      {palette && (
        <div className="kb-fmt-palette" role="menu" aria-label={open === 'color' ? '文字颜色' : '背景颜色'}>
          {palette.map((c) => {
            const value = c.value
            const current = (open === 'color' ? state.color : state.bg) ?? ''
            return (
              <button
                key={c.name}
                type="button"
                role="menuitem"
                className={`kb-fmt-swatch${value === '' ? ' kb-fmt-swatch-none' : ''}${current === value ? ' is-on' : ''}`}
                style={value ? { background: value } : undefined}
                aria-label={`${c.name}${value ? ` ${value}` : '（无）'}`}
                title={`${c.name}${value ? ` ${value}` : '（无）'}`}
                data-color={value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault()
                  onColor(open === 'color' ? 'color' : 'background-color', value)
                  setOpen(null)
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

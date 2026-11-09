import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

export interface ModalProps {
  open: boolean
  title: string
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
}

/** Tab 循环用的可聚焦元素 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** 打开时应优先聚焦的输入类控件（契约：没有才退回聚焦面板） */
const FIRST_INPUT = [
  'input:not([type="hidden"]):not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
].join(',')

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0,
  )
}

export function Modal({ open, title, children, footer, onClose }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // 用 ref 存最新的关闭回调：effect 只依赖 open，
  // 否则调用方每次渲染传入新的内联箭头函数都会让 effect 重跑（正是「只能输入 1 个字符」的根因）。
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // 只在这里聚焦一次：优先第一个输入框，没有才聚焦面板本身
    const firstInput = panel.querySelector<HTMLElement>(FIRST_INPUT)
    ;(firstInput ?? panel).focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      // 焦点陷阱：Tab / Shift+Tab 在弹窗内循环，不跑到背后的页面
      const items = focusableIn(panel)
      if (items.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && panel.contains(active)

      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // 关闭后把焦点还给打开它的元素（还在文档里才还给）
      if (previous && document.contains(previous)) previous.focus()
    }
  }, [open])

  if (!open) return null

  // 挂到 body：避免被祖先的 transform（抽屉 translateX）影响 fixed 定位，
  // 也避免落进侧栏的 inert 子树里（那里无法聚焦、也点不到）。
  return createPortal(
    <div
      className="kb-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="kb-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="kb-modal__header">
          <h2 className="kb-modal__title">{title}</h2>
        </div>
        {children ? <div className="kb-modal__body">{children}</div> : null}
        {footer ? <div className="kb-modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { IconAlert, IconCheck, IconClose, IconInfo, IconWarn } from './Icon'

export type ToastKind = 'success' | 'error' | 'info' | 'warn'

interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

export interface ToastApi {
  success: (text: string) => void
  error: (text: string) => void
  info: (text: string) => void
  /** 提醒（非致命）：与 ViewContext.toast.warn 对齐 */
  warn: (text: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const ICONS: Record<ToastKind, ReactNode> = {
  success: <IconCheck size={15} />,
  error: <IconAlert size={15} />,
  info: <IconInfo size={15} />,
  warn: <IconWarn size={15} />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seqRef = useRef(0)
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (kind: ToastKind, text: string) => {
      seqRef.current += 1
      const id = seqRef.current
      // 同时最多 4 条，超出丢弃最旧的
      setItems((prev) => [...prev.slice(-3), { id, kind, text }])
      const timer = setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3600)
      timersRef.current.set(id, timer)
    },
    [dismiss],
  )

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => clearTimeout(timer))
      timersRef.current.clear()
    },
    [],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => push('success', text),
      error: (text) => push('error', text),
      info: (text) => push('info', text),
      warn: (text) => push('warn', text),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="kb-toast-stack" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`kb-toast kb-toast--${item.kind}`}>
            <span className="kb-toast__icon">{ICONS[item.kind]}</span>
            <span className="kb-toast__text">{item.text}</span>
            <button
              type="button"
              className="kb-btn kb-btn--icon kb-toast__close"
              onClick={() => dismiss(item.id)}
              aria-label="关闭提示"
            >
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast 必须在 ToastProvider 内使用')
  return context
}

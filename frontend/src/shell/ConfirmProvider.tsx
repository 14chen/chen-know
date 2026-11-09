import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import type { ConfirmOptions } from '@/views/types'

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

/**
 * Promise 化的确认框（ViewContext.confirm 的实现）。
 * 视图与外壳都不必碰原生 `confirm()`；同一时刻只保留一个待决确认框，
 * 新的确认会先把旧的按「取消」结算，避免 Promise 悬挂。
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const pendingRef = useRef<PendingConfirm | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      pendingRef.current?.resolve(false)
      const entry: PendingConfirm = { options, resolve }
      pendingRef.current = entry
      setPending(entry)
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    const entry = pendingRef.current
    pendingRef.current = null
    setPending(null)
    entry?.resolve(value)
  }, [])

  const options = pending?.options

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={pending !== null}
        title={options?.title ?? ''}
        onClose={() => settle(false)}
        footer={
          <>
            <Button onClick={() => settle(false)}>{options?.cancelText ?? '取消'}</Button>
            <Button
              variant={options?.danger ? 'danger' : 'primary'}
              onClick={() => settle(true)}
            >
              {options?.confirmText ?? '确定'}
            </Button>
          </>
        }
      >
        {options?.message}
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm 必须在 ConfirmProvider 内使用')
  return context
}

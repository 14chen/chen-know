import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

export function Badge({
  tone = 'neutral',
  dot = false,
  children,
}: {
  tone?: BadgeTone
  dot?: boolean
  children: ReactNode
}) {
  return (
    <span className={['kb-badge', tone === 'neutral' ? '' : `kb-badge--${tone}`].filter(Boolean).join(' ')}>
      {dot ? <span className="kb-dot" /> : null}
      {children}
    </span>
  )
}

import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  desc?: ReactNode
  action?: ReactNode
}

export function EmptyState({ icon, title, desc, action }: EmptyStateProps) {
  return (
    <div className="kb-empty">
      {icon ? <div className="kb-empty__icon">{icon}</div> : null}
      <p className="kb-empty__title">{title}</p>
      {desc ? <p className="kb-empty__desc">{desc}</p> : null}
      {action}
    </div>
  )
}

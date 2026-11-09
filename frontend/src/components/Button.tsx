import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { IconSpinner } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  block?: boolean
  /** 展示 loading 并自动禁用 */
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'kb-btn',
    variant === 'icon' ? 'kb-btn--icon' : `kb-btn--${variant}`,
    size === 'sm' ? 'kb-btn--sm' : '',
    block ? 'kb-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button {...rest} type={type} className={classes} disabled={disabled || loading} aria-busy={loading}>
      {loading ? <IconSpinner size={16} /> : icon}
      {children}
    </button>
  )
}

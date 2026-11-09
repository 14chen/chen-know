import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: ReactNode
  invalid?: boolean
  /** 输入框右侧的操作按钮（如密码可见性切换） */
  action?: ReactNode
  ref?: Ref<HTMLInputElement>
}

export function TextField({
  label,
  hint,
  invalid = false,
  action,
  className,
  id,
  ref,
  ...rest
}: TextFieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId

  const input = (
    <input
      {...rest}
      ref={ref}
      id={inputId}
      className={['kb-input', invalid ? 'kb-input--invalid' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      aria-invalid={invalid || undefined}
    />
  )

  return (
    <div className="kb-field">
      {label ? (
        <label className="kb-field__label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      {action ? (
        <div className="kb-input-affix">
          {input}
          <span className="kb-input-affix__action">{action}</span>
        </div>
      ) : (
        input
      )}
      {hint ? <span className="kb-field__hint">{hint}</span> : null}
    </div>
  )
}

import { useId } from 'react'
import type { SelectHTMLAttributes } from 'react'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: SelectOption[]
}

export function Select({ label, options, className, id, ...rest }: SelectProps) {
  const autoId = useId()
  const selectId = id ?? autoId

  return (
    <div className="kb-field">
      {label ? (
        <label className="kb-field__label" htmlFor={selectId}>
          {label}
        </label>
      ) : null}
      <select
        {...rest}
        id={selectId}
        className={['kb-select', className ?? ''].filter(Boolean).join(' ')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

import type { ReactNode } from 'react'
import { FieldError } from '@/components/forms/FieldError'

type AccountIdentityFieldLabelRowProps = {
  label: ReactNode
  htmlFor?: string
  error?: string
  errorId?: string
}

/**
 * Keeps validation feedback aligned with labels without shifting the field below
 */
export function AccountIdentityFieldLabelRow({
  label,
  htmlFor,
  error,
  errorId,
}: AccountIdentityFieldLabelRowProps) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-3">
      <label htmlFor={htmlFor} className="app-label block shrink-0 text-[0.9375rem] leading-5">
        {label}
      </label>
      <FieldError message={error} id={errorId} />
    </div>
  )
}

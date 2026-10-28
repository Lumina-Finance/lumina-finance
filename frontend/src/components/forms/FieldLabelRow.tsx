import type { ReactNode } from 'react'
import { FieldError } from '@/components/forms/FieldError'
import { joinClassNames } from '@/utils/classNames'

interface FieldLabelRowProps {
  label: ReactNode
  /** The control the label names. Left out for a group, whose heading names it through `aria-labelledby` */
  htmlFor?: string
  /** Id for the label, for a group or control that points to it with `aria-labelledby` */
  labelId?: string
  error?: string | false | null
  /** Id for the message, so the field it is about can point to it as its description */
  errorId?: string
  /** The small label a dense form uses, in place of the app's usual label size */
  compact?: boolean
  /** Replaces the room under the row, for a form whose labels sit closer to their fields */
  spacingClassName?: string
}

/**
 * A field's label with its problem opposite it, for a dialog field whose feature folder has no label
 * row of its own, such as a password, a passkey name or a group of tick boxes
 */
export function FieldLabelRow({
  label,
  htmlFor,
  labelId,
  error,
  errorId,
  compact = false,
  spacingClassName = 'mb-1.5',
}: FieldLabelRowProps) {
  return (
    <div className={joinClassNames('flex min-w-0 items-start justify-between gap-3', spacingClassName)}>
      <label
        id={labelId}
        htmlFor={htmlFor}
        className={joinClassNames('app-label block min-w-0 leading-5', compact && 'text-xs')}
      >
        {label}
      </label>
      <FieldError message={error} id={errorId} className="min-w-0 shrink" />
    </div>
  )
}

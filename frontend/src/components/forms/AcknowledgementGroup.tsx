import type { ReactNode } from 'react'
import { FieldLabelRow } from '@/components/forms/FieldLabelRow'
import { getAcknowledgementItemId } from '@/components/forms/acknowledgement'

export interface AcknowledgementItem {
  /** Names the box within its group, for its id */
  key: string
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  /** A statement long enough to wrap, so the box lines up with its first line */
  multiline?: boolean
}

interface AcknowledgementGroupProps {
  /** Unique to the dialog, so the owner can focus a box by `getAcknowledgementItemId` */
  groupId: string
  heading: string
  items: AcknowledgementItem[]
  error?: string | false | null
  errorId: string
  disabled?: boolean
}

/**
 * A heading over tick boxes the person must all tick, with what is missing opposite the heading and each
 * unticked box marked while it shows
 */
export function AcknowledgementGroup({ groupId, heading, items, error, errorId, disabled = false }: AcknowledgementGroupProps) {
  const headingId = `${groupId}-heading`

  return (
    <div role="group" aria-labelledby={headingId}>
      <FieldLabelRow label={heading} labelId={headingId} error={error} errorId={errorId} spacingClassName="mb-2" />
      <div className="space-y-2">
        {items.map((item) => {
          const marked = !!error && !item.checked
          return (
            <label
              key={item.key}
              className={`flex gap-2 text-sm ${item.multiline ? 'items-start' : 'items-center'}`}
              style={{ color: 'var(--app-text-muted)' }}
            >
              <input
                id={getAcknowledgementItemId(groupId, item.key)}
                type="checkbox"
                className={`app-checkbox ${item.multiline ? 'mt-0.5 shrink-0' : ''}`}
                checked={item.checked}
                onChange={(event) => item.onChange(event.target.checked)}
                disabled={disabled}
                aria-invalid={marked ? true : undefined}
                aria-describedby={marked ? errorId : undefined}
              />
              {item.multiline ? <span>{item.label}</span> : item.label}
            </label>
          )
        })}
      </div>
    </div>
  )
}

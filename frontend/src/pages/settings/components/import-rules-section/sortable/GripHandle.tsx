import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { GripVertical } from 'lucide-react'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'

type GripHandleProps = Omit<ComponentPropsWithoutRef<typeof DisabledReasonButton>, 'children'> & {
  /** Names the grip for a screen reader, such as "Move condition 2" */
  label: string

  /** Why the grip can't be used right now. While set it explains itself and starts no drag */
  disabledReason?: string | null
}

/**
 * The handle a row is picked up by. It is a button, so it takes focus and a keyboard can pick the row up
 */
export const GripHandle = forwardRef<HTMLButtonElement, GripHandleProps>(function GripHandle(
  { label, disabledReason, className = '', ...rest },
  ref,
) {
  return (
    <DisabledReasonButton
      {...rest}
      ref={ref}
      aria-label={label}
      disabledReason={disabledReason}
      className={`app-icon-button shrink-0 touch-none ${disabledReason ? '' : 'cursor-grab active:cursor-grabbing'} ${className}`}
    >
      <GripVertical size={18} aria-hidden />
    </DisabledReasonButton>
  )
})

import { HandCoins } from 'lucide-react'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'

interface RefundButtonProps {
  onClick: () => void

  /** Why a refund can't be started now, shown in the shared tooltip. Without one the button works */
  disabledReason?: string | null
}

/**
 * Opens a refund of the expense on screen. It rests as an icon with no border and grows into a labelled,
 * bordered button under the pointer and on keyboard focus, and rests grown on a touch screen. While
 * nothing is left to refund it is held off, with the reason in the shared tooltip
 */
export default function RefundButton({ onClick, disabledReason }: RefundButtonProps) {
  return (
    <DisabledReasonButton
      data-testid="transaction-refund"
      aria-label="Refund"
      onClick={onClick}
      disabledReason={disabledReason}
      className="app-expanding-button shrink-0"
    >
      <HandCoins size={16} aria-hidden />
      <span className="app-expanding-button-label" aria-hidden>
        <span>Refund</span>
      </span>
    </DisabledReasonButton>
  )
}

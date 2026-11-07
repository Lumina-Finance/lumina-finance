import { useRef } from 'react'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { useConfirmingClick } from '@/hooks/useConfirmingClick'

const TONE_CLASS_NAMES = {
  primary: 'app-primary-button',
  secondary: 'app-secondary-button',
  danger: 'app-danger-button',
} as const

type ReviewDecisionButtonProps = {
  label: string
  tone: keyof typeof TONE_CLASS_NAMES

  /** Set while this decision runs, which swaps the label for a spinner */
  loading: boolean
  disabled: boolean

  /** Left out by a decision that submits its form */
  onClick?: () => void

  /**
   * Makes the decision take two presses, as Delete does: the first changes the label to `label` and says
   * `announcement` to a screen reader, and the second runs `onClick`. A press elsewhere, or focus moving
   * on, takes the first back
   */
  confirm?: { label: string; announcement: string }

  /** Takes focus when its modal opens, for a modal with no field to start on */
  initialFocus?: boolean
  testId?: string
}

/**
 * One decision on a bank item, sized to its label. A new label, or the spinner while the decision runs,
 * crossfades in as the button eases to its width. Full width on phones, where the decisions share the
 * footer's width
 */
export function ReviewDecisionButton({
  label,
  tone,
  loading,
  disabled,
  onClick,
  confirm,
  initialFocus,
  testId,
}: ReviewDecisionButtonProps) {
  const pressRef = useRef<HTMLButtonElement | null>(null)
  const [confirming, setConfirming] = useConfirmingClick(pressRef, loading)
  const shownLabel = confirming && confirm ? confirm.label : label

  const handleClick = () => {
    if (confirm && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    onClick?.()
  }

  return (
    <>
      <button
        ref={pressRef}
        type={onClick ? 'button' : 'submit'}
        // The modal starts focus among its field tab stops, which a button joins only when marked
        data-modal-field-tab-stop={initialFocus ? 'true' : undefined}
        data-modal-initial-focus={initialFocus ? 'true' : undefined}
        data-testid={testId}
        aria-label={shownLabel}
        aria-busy={loading}
        onClick={onClick ? handleClick : undefined}
        onBlur={() => setConfirming(false)}
        disabled={disabled}
        className={`${TONE_CLASS_NAMES[tone]} relative shrink-0 overflow-hidden whitespace-nowrap ${loading ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : 'w-full sm:w-auto'}`}
      >
        {/* One crossfade for the label and the spinner, so the width eases with whichever comes in. The
            button's name already says which label is on */}
        <PendingLabel pending={loading} name={shownLabel} contentKey={shownLabel}>
          <span aria-hidden>{shownLabel}</span>
        </PendingLabel>
      </button>
      {confirm && (
        <span role="status" className="sr-only">
          {confirming ? confirm.announcement : ''}
        </span>
      )}
    </>
  )
}

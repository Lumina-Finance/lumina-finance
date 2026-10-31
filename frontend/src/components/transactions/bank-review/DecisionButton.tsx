import { useCallback, useRef } from 'react'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { useConfirmingClick } from '@/hooks/useConfirmingClick'
import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'

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
 * One decision on a bank item, sized to its label, which it shrinks from into its spinner while the
 * decision runs. Full width on phones, where the decisions share the footer's width
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
  // Fitted to the label on show, so the width eases from one label's to the other's as the label changes
  const { buttonRef, style, measure } = useFittedButtonWidth(shownLabel)
  const setButton = useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node
      pressRef.current = node
    },
    [buttonRef],
  )

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
        ref={setButton}
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
        className={`${TONE_CLASS_NAMES[tone]} relative overflow-hidden whitespace-nowrap ${loading ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : 'w-full sm:w-(--fit-width)'}`}
        style={style}
      >
        {measure}
        <PendingLabel pending={loading} name={shownLabel}>
          {confirm ? (
            <>
              {/* Both labels sit over each other and swap by opacity while the width eases to the shown one's,
                  so neither pops in. The button's name already says which one is on */}
              <span
                aria-hidden
                className="absolute inset-0 flex items-center justify-center transition-opacity motion-reduce:transition-none"
                style={{ opacity: confirming ? 0 : 1 }}
              >
                {label}
              </span>
              <span
                aria-hidden
                className="absolute inset-0 flex items-center justify-center transition-opacity motion-reduce:transition-none"
                style={{ opacity: confirming ? 1 : 0 }}
              >
                {confirm.label}
              </span>
            </>
          ) : (
            label
          )}
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

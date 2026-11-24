import { PendingLabel } from '@/components/loading/PendingLabel'
import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'

type ApplyRulesButtonProps = {
  /** Set while this press runs. The button is held off and shows a spinner */
  isApplying: boolean

  /** Set while the other press of the block runs. The button is held off with no spinner */
  isHeldOff: boolean
  onApply: () => void
}

const LABEL = 'Apply rules'

/**
 * Puts the waiting items through the import rules as they stand now and saves what the rules give.
 * It is the same small secondary button as Approve all, with the same width kept while it is busy
 */
export function ApplyRulesButton({ isApplying, isHeldOff, onApply }: ApplyRulesButtonProps) {
  const { buttonRef, style, measure } = useFittedButtonWidth(LABEL)

  // The padding matches Approve all, so the label is whole while it fades out under the spinner. On a
  // phone the button spans its line, under the sentence it answers
  return (
    <button
      ref={buttonRef}
      type="button"
      className="app-secondary-button relative h-8 w-full shrink-0 whitespace-nowrap px-3.5 text-sm sm:w-(--fit-width)"
      style={style}
      aria-busy={isApplying}
      disabled={isApplying || isHeldOff}
      onClick={onApply}
    >
      {measure}
      <PendingLabel pending={isApplying} name={LABEL}>
        {LABEL}
      </PendingLabel>
    </button>
  )
}

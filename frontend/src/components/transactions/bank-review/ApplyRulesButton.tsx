import type { BankReviewRules } from '@/api/bank-sync'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { getApplyRulesReason } from '@/components/transactions/utils/bankReview'
import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'

type ApplyRulesButtonProps = {
  /** What the rules do to the waiting items, from the first page of the list */
  rules: BankReviewRules

  /** Set while a press runs. The button is held off and shows a spinner */
  isApplying: boolean
  onApply: () => void
}

const LABEL = 'Apply rules'

/**
 * Adds every waiting item the user's import rules give a merchant and a category to the ledger, at
 * once. It stays focusable while greyed and says why on hover and on keyboard focus
 */
export function ApplyRulesButton({ rules, isApplying, onApply }: ApplyRulesButtonProps) {
  // The button keeps its label's width while the spinner shows. On a phone a narrower button would
  // let the line beside it wrap again in the middle of a press
  const { buttonRef, style, measure } = useFittedButtonWidth(LABEL)

  return (
    <DisabledReasonButton
      ref={buttonRef}
      type="button"
      className="app-secondary-button relative h-8 w-(--fit-width) shrink-0 whitespace-nowrap px-3 text-sm"
      style={style}
      aria-busy={isApplying}
      disabled={isApplying}
      disabledReason={isApplying ? null : getApplyRulesReason(rules)}
      onClick={onApply}
    >
      {measure}
      <PendingLabel pending={isApplying} name={LABEL}>
        {LABEL}
      </PendingLabel>
    </DisabledReasonButton>
  )
}

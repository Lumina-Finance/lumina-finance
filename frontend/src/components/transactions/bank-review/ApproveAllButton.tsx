import type { BankReviewRules } from '@/api/bank-sync'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { getApproveAllReason } from '@/components/transactions/utils/bankReview'
import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'

type ApproveAllButtonProps = {
  /** What the saved values hold, from the first page of the list */
  rules: Pick<BankReviewRules, 'any_addable' | 'read_only_reason'>

  /** Set while this press runs. The button is held off and shows a spinner */
  isApproving: boolean

  /** Set while the other press of the block runs. The button is held off with no reason and no spinner */
  isHeldOff: boolean
  onApprove: () => void
}

const LABEL = 'Approve all'

/**
 * Adds every waiting item whose saved values hold a merchant and a category to the ledger, at once.
 * It stays focusable while greyed and says why on hover and on keyboard focus
 */
export function ApproveAllButton({ rules, isApproving, isHeldOff, onApprove }: ApproveAllButtonProps) {
  // The button keeps its label's width while the spinner shows. On a phone a narrower button would
  // let the line beside it wrap again in the middle of a press
  const { buttonRef, style, measure } = useFittedButtonWidth(LABEL)
  const isBusy = isApproving || isHeldOff

  // The label fades out in a layer set 1rem inside each end of the button. With less padding than this
  // the layer is narrower than the label and cuts the label's ends for the length of the fade
  return (
    <DisabledReasonButton
      ref={buttonRef}
      type="button"
      className="app-secondary-button relative h-8 w-(--fit-width) shrink-0 whitespace-nowrap px-3.5 text-sm"
      style={style}
      aria-busy={isApproving}
      disabled={isBusy}
      disabledReason={isBusy ? null : getApproveAllReason(rules)}
      onClick={onApprove}
    >
      {measure}
      <PendingLabel pending={isApproving} name={LABEL}>
        {LABEL}
      </PendingLabel>
    </DisabledReasonButton>
  )
}

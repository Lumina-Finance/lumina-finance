import type { SyntheticEvent } from 'react'
import type { FxStatus } from '@/api/shared/fx'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { getBudgetUtilizationFxStatusMessage } from '@/pages/budgets/utils/fxTooltipMessages'

// A budget that leaves spending out tracks less than its categories hold. Its badge turns red and gives these sentences
const WITHHELD_MESSAGE =
  "Spending in other currencies is not counted. Your account doesn't have access to FX conversions"
// A read-only budget's grey badge gives this sentence. Neither badge repeats the Read-only pill's reason
const READ_ONLY_WITHHELD_MESSAGE = "Spending in other currencies isn't counted in this budget"

/**
 * Renders the budget FX status badge while preserving optional card event boundaries
 */
export default function BudgetFxStatusBadge({
  fxStatus,
  label,
  placement = 'top',
  stopPropagation = false,
  getMessage = getBudgetUtilizationFxStatusMessage,
  readOnly = false,
}: {
  fxStatus: FxStatus | undefined
  label: string
  placement?: 'top' | 'bottom'
  stopPropagation?: boolean
  getMessage?: (fxStatus: FxStatus) => string
  // A read-only budget tracks nothing new, so its badge stays grey
  readOnly?: boolean
}) {
  if (!fxStatus) return null

  const stopEvent = (event: SyntheticEvent) => event.stopPropagation()

  return (
    <span
      className="inline-flex items-center leading-none"
      onClick={stopPropagation ? stopEvent : undefined}
      onKeyDown={stopPropagation ? stopEvent : undefined}
    >
      <FxStatusBadge
        fxStatus={fxStatus}
        label={label}
        placement={placement}
        getMessage={getMessage}
        withheldTone={readOnly ? 'gray' : 'red'}
        withheldMessage={readOnly ? READ_ONLY_WITHHELD_MESSAGE : WITHHELD_MESSAGE}
        hidesWithheldReason
      />
    </span>
  )
}

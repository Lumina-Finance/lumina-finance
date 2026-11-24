import type { SyntheticEvent } from 'react'
import type { FxStatus } from '@/api/shared/fx'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { getBudgetUtilizationFxStatusMessage } from '@/pages/budgets/utils/fxTooltipMessages'

// A budget that leaves spending out tracks less than its categories hold. Its badge turns red and gives this sentence
const WITHHELD_MESSAGE = 'This budget counts only spending from accounts in its own currency'

/**
 * Renders the budget FX status badge while preserving optional card event boundaries
 */
export default function BudgetFxStatusBadge({
  fxStatus,
  label,
  placement = 'top',
  stopPropagation = false,
  getMessage = getBudgetUtilizationFxStatusMessage,
}: {
  fxStatus: FxStatus | undefined
  label: string
  placement?: 'top' | 'bottom'
  stopPropagation?: boolean
  getMessage?: (fxStatus: FxStatus) => string
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
        withheldTone="red"
        withheldMessage={WITHHELD_MESSAGE}
      />
    </span>
  )
}

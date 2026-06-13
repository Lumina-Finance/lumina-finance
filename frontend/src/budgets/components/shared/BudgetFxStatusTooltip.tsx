import type { SyntheticEvent } from 'react'
import type { FxStatus } from '@/api/shared/fx'
import { FxStatusTooltip } from '@/components/FxStatusTooltip'
import { getBudgetUtilizationFxStatusMessage } from '@/budgets/utils/fxTooltipMessages'

/**
 * Renders the budget FX tooltip while preserving optional card event boundaries
 */
export default function BudgetFxStatusTooltip({
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
      <FxStatusTooltip
        fxStatus={fxStatus}
        label={label}
        placement={placement}
        getMessage={getMessage}
      />
    </span>
  )
}

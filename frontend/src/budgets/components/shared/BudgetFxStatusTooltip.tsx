import type { SyntheticEvent } from 'react'
import type { FxStatus } from '@/api/dashboard'
import IconTooltip from '@/components/IconTooltip'
import { getBudgetUtilizationFxStatusMessage } from '@/budgets/utils/fxTooltipMessages'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'

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
      <IconTooltip
        label={label}
        icon="fx"
        fxTone={getFxStatusTone(fxStatus)}
        placement={placement}
      >
        <span className="block">{getMessage(fxStatus)}</span>
        {fxStatus.missing_pairs.length > 0 && (
          <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
            Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
          </span>
        )}
      </IconTooltip>
    </span>
  )
}

import type { SyntheticEvent } from 'react'
import type { FxStatus } from '@/api/dashboard'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusMessage, getFxStatusTone } from '@/dashboard/utils/fxStatus'

export default function BudgetFxStatusTooltip({
  fxStatus,
  label,
  placement = 'top',
  stopPropagation = false,
}: {
  fxStatus: FxStatus | undefined
  label: string
  placement?: 'top' | 'bottom'
  stopPropagation?: boolean
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
        widthClassName="w-64"
      >
        <span className="block">{getFxStatusMessage(fxStatus)}</span>
        {fxStatus.missing_pairs.length > 0 && (
          <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
            Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
          </span>
        )}
      </IconTooltip>
    </span>
  )
}

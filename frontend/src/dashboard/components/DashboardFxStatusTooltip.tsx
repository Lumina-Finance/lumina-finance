import type { FxStatus } from '@/api/shared/fx'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusTone } from '@/utils/fxStatus'

type DashboardFxStatusTooltipProps = {
  label: string
  fxStatus: FxStatus | undefined
  getMessage: (fxStatus: FxStatus) => string
}

/**
 * Renders the shared dashboard FX tooltip including missing currency pair details
 */
export function DashboardFxStatusTooltip({
  label,
  fxStatus,
  getMessage,
}: DashboardFxStatusTooltipProps) {
  if (!fxStatus) return null

  return (
    <IconTooltip
      label={label}
      icon="fx"
      fxTone={getFxStatusTone(fxStatus)}
      placement="top"
    >
      <span className="block">{getMessage(fxStatus)}</span>
      {fxStatus.missing_pairs.length > 0 && (
        <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
        </span>
      )}
    </IconTooltip>
  )
}

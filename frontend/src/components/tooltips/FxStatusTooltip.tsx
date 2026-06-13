import type { FxStatus } from '@/api/shared/fx'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { formatMissingFxPairs, getFxStatusTone } from '@/utils/fxStatus'

type FxStatusTooltipProps = {
  label: string
  fxStatus: FxStatus | undefined
  getMessage: (fxStatus: FxStatus) => string
  placement?: 'top' | 'bottom'
}

/**
 * Renders shared FX tooltip content including missing currency pair details
 */
export function FxStatusTooltip({
  label,
  fxStatus,
  getMessage,
  placement = 'top',
}: FxStatusTooltipProps) {
  if (!fxStatus) return null

  return (
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
  )
}

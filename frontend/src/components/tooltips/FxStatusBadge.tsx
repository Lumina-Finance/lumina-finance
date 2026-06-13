import type { FxStatus } from '@/api/shared/fx'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { formatMissingFxPairs, getFxStatusTone } from '@/utils/fxStatus'

type FxStatusBadgeProps = {
  label: string
  fxStatus: FxStatus | undefined
  getMessage: (fxStatus: FxStatus) => string
  placement?: 'top' | 'bottom'
}

/**
 * Renders the shared FX status badge and tooltip content including missing currency pair details
 */
export function FxStatusBadge({
  label,
  fxStatus,
  getMessage,
  placement = 'top',
}: FxStatusBadgeProps) {
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

import type { FxStatus } from '@/api/shared/fx'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { formatMissingFxPairs, getFxStatusMessage, getFxStatusTone } from '@/utils/fxStatus'

type FxStatusBadgeProps = {
  label: string
  fxStatus: FxStatus | undefined
  getMessage?: (fxStatus: FxStatus) => string | undefined
  placement?: 'top' | 'bottom'
}

const FX_STATUS_FALLBACK_MESSAGE = 'FX conversion did not complete. Values may be incomplete'

/**
 * Renders the shared FX status badge and tooltip content including missing currency pair details
 */
export function FxStatusBadge({
  label,
  fxStatus,
  getMessage = getFxStatusMessage,
  placement = 'top',
}: FxStatusBadgeProps) {
  if (!fxStatus) return null
  const message = getMessage(fxStatus) ?? FX_STATUS_FALLBACK_MESSAGE

  return (
    <IconTooltip
      label={label}
      icon="fx"
      fxTone={getFxStatusTone(fxStatus)}
      placement={placement}
    >
      <span className="block">{message}</span>
      {fxStatus.missing_pairs.length > 0 && (
        <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
        </span>
      )}
    </IconTooltip>
  )
}

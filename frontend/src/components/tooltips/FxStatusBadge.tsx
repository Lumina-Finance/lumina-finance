import type { FxStatus } from '@/api/shared/fx'
import type { IconTooltipFxTone } from '@/components/tooltips/fxToneClass'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { formatMissingFxPairs, getFxStatusMessage, getFxStatusTone } from '@/utils/fxStatus'

type FxStatusBadgeProps = {
  label: string
  fxStatus: FxStatus | undefined
  getMessage?: (fxStatus: FxStatus) => string | undefined
  placement?: 'top' | 'bottom'
  // Overrides the tone the status gives, for a gap that is no failure
  tone?: IconTooltipFxTone
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
  tone,
}: FxStatusBadgeProps) {
  if (!fxStatus) return null

  // Amounts left out because converting them is refused say why, in the neutral tone of a total that
  // used no conversion, whatever message or tone the caller would give
  const { withheld_reason: withheldReason } = fxStatus
  const message = withheldReason || (getMessage(fxStatus) ?? FX_STATUS_FALLBACK_MESSAGE)
  const fxTone = withheldReason ? 'gray' : (tone ?? getFxStatusTone(fxStatus))

  return (
    <IconTooltip label={label} icon="fx" fxTone={fxTone} placement={placement}>
      <span className="block">{message}</span>
      {fxStatus.missing_pairs.length > 0 && (
        <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
        </span>
      )}
    </IconTooltip>
  )
}

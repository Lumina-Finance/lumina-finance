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

  // For a badge inside a row that does something else on a press, as the icon tooltip describes them
  widensHitArea?: boolean
  picksSideOnPress?: boolean
  clearsStickyBars?: boolean
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
  widensHitArea,
  picksSideOnPress,
  clearsStickyBars,
}: FxStatusBadgeProps) {
  if (!fxStatus) return null

  // Amounts left out because converting them is refused say why, in the neutral tone of a total that
  // used no conversion, whatever message or tone the caller would give. A total that also lacks a rate
  // keeps its failure message and tone, and the sentence follows the message
  const { withheld_reason: withheldReason } = fxStatus
  const isOnlyWithheld = Boolean(withheldReason) && fxStatus.missing_pairs.length === 0
  const message = isOnlyWithheld ? withheldReason : (getMessage(fxStatus) ?? FX_STATUS_FALLBACK_MESSAGE)
  const fxTone = isOnlyWithheld ? 'gray' : (tone ?? getFxStatusTone(fxStatus))

  return (
    <IconTooltip
      label={label}
      icon="fx"
      fxTone={fxTone}
      placement={placement}
      widensHitArea={widensHitArea}
      picksSideOnPress={picksSideOnPress}
      clearsStickyBars={clearsStickyBars}
    >
      <span className="block">{message}</span>
      {withheldReason && !isOnlyWithheld && <span className="mt-2 block">{withheldReason}</span>}
      {fxStatus.missing_pairs.length > 0 && (
        <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
        </span>
      )}
    </IconTooltip>
  )
}

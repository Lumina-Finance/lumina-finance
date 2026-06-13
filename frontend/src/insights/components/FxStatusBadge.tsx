import type { FxStatus } from '@/api/shared/fx'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusMessage, getFxStatusTone } from '@/utils/fxStatus'

type FxStatusBadgeProps = {
  label: string
  status: FxStatus
  getMessage?: (status: FxStatus) => string
}

export function FxStatusBadge({ label, status, getMessage = getFxStatusMessage }: FxStatusBadgeProps) {
  return (
    <IconTooltip
      label={label}
      icon="fx"
      fxTone={getFxStatusTone(status)}
      placement="top"
    >
      <span className="block">{getMessage(status)}</span>
      {status.missing_pairs.length > 0 && (
        <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Missing: {formatMissingFxPairs(status.missing_pairs)}
        </span>
      )}
    </IconTooltip>
  )
}

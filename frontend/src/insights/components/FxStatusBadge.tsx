import type { FxStatus } from '@/api/dashboard'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusMessage, getFxStatusTone } from '@/dashboard/utils/fxStatus'

type FxStatusBadgeProps = {
  label: string
  status: FxStatus
}

export function FxStatusBadge({ label, status }: FxStatusBadgeProps) {
  return (
    <IconTooltip
      label={label}
      icon="fx"
      fxTone={getFxStatusTone(status)}
      placement="top"
    >
      <span className="block">{getFxStatusMessage(status)}</span>
      {status.missing_pairs.length > 0 && (
        <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Missing: {formatMissingFxPairs(status.missing_pairs)}
        </span>
      )}
    </IconTooltip>
  )
}

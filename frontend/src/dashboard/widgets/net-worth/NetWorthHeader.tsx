import { Wallet } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getNetWorthFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'

type NetWorthHeaderProps = {
  fxStatus: FxStatus | undefined
}

/**
 * Renders the net worth widget label and foreign exchange status tooltip
 */
export function NetWorthHeader({ fxStatus }: NetWorthHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
        <Wallet size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
      </div>
      <span className="app-label">Net Worth</span>
      {fxStatus && (
        <IconTooltip
          label="Net worth FX status"
          icon="fx"
          fxTone={getFxStatusTone(fxStatus)}
          placement="top"
        >
          <span className="block">{getNetWorthFxStatusMessage(fxStatus)}</span>
          {fxStatus.missing_pairs.length > 0 && (
            <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
            </span>
          )}
        </IconTooltip>
      )}
    </div>
  )
}

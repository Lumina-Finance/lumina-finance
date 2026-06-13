import { ArrowUpToLine, Repeat } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getSavingsRateFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'

type SavingsRateHeaderProps = {
  fxStatus: FxStatus | undefined
  capSavingsRateChart: boolean
  onCapToggle: () => void
}

/**
 * Renders the savings rate label, FX tooltip, and bounded chart toggle
 */
export function SavingsRateHeader({
  fxStatus,
  capSavingsRateChart,
  onCapToggle,
}: SavingsRateHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
        <Repeat size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
      </div>
      <span className="app-label">Savings Rate</span>
      {fxStatus && (
        <IconTooltip
          label="Savings rate FX status"
          icon="fx"
          fxTone={getFxStatusTone(fxStatus)}
          placement="top"
        >
          <span className="block">{getSavingsRateFxStatusMessage(fxStatus)}</span>
          {fxStatus.missing_pairs.length > 0 && (
            <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
            </span>
          )}
        </IconTooltip>
      )}
      <button
        type="button"
        onClick={onCapToggle}
        title={capSavingsRateChart ? 'Show uncapped savings rate chart' : 'Cap savings rate chart at plus or minus 100%'}
        aria-label={capSavingsRateChart ? 'Show uncapped savings rate chart' : 'Cap savings rate chart at plus or minus 100%'}
        className="app-icon-button ml-auto"
      >
        <ArrowUpToLine
          size={12}
          className={`transition-transform duration-150 motion-reduce:transition-none ${capSavingsRateChart ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  )
}

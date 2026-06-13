import { ArrowUpToLine, Repeat } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import { DashboardFxStatusTooltip } from '@/dashboard/components/DashboardFxStatusTooltip'
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
      <DashboardFxStatusTooltip
        label="Savings rate FX status"
        fxStatus={fxStatus}
        getMessage={getSavingsRateFxStatusMessage}
      />
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

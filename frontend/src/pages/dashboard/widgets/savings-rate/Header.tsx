import { ArrowUpToLine, Repeat } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { HintButton } from '@/components/tooltips/HintButton'
import { DashboardWidgetHeaderIcon } from '@/pages/dashboard/components/WidgetHeaderIcon'
import { getSavingsRateFxStatusMessage } from '@/utils/fxTooltipMessages'

type SavingsRateHeaderProps = {
  fxStatus: FxStatus | undefined
  capSavingsRateChart: boolean
  onCapToggle: () => void
}

/**
 * Renders the savings rate label, FX tooltip, and bounded chart toggle
 */
export function SavingsRateHeader({ fxStatus, capSavingsRateChart, onCapToggle }: SavingsRateHeaderProps) {
  const toggleLabel = capSavingsRateChart
    ? 'Show uncapped savings rate chart'
    : 'Cap savings rate chart at plus or minus 100%'

  return (
    <div className="flex items-center gap-2 mb-3">
      <DashboardWidgetHeaderIcon icon={Repeat} />
      <span className="app-label">Savings rate</span>
      <FxStatusBadge label="Savings rate FX status" fxStatus={fxStatus} getMessage={getSavingsRateFxStatusMessage} />
      <HintButton onClick={onCapToggle} hint={toggleLabel} aria-label={toggleLabel} className="app-icon-button ml-auto">
        <ArrowUpToLine
          size={12}
          className={`transition-transform motion-reduce:transition-none ${capSavingsRateChart ? 'rotate-180' : ''}`}
        />
      </HintButton>
    </div>
  )
}

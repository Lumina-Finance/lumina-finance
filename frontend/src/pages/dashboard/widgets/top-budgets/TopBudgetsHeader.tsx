import { PieChart as PieChartIcon } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import { FxStatusTooltip } from '@/components/tooltips/FxStatusTooltip'
import { DashboardWidgetHeaderIcon } from '@/pages/dashboard/components/DashboardWidgetHeaderIcon'
import { getTopBudgetsFxStatusMessage } from '@/utils/fxTooltipMessages'

type TopBudgetsHeaderProps = {
  fxStatus: FxStatus
}

/**
 * Renders the top budgets label and combined foreign exchange status
 */
export function TopBudgetsHeader({ fxStatus }: TopBudgetsHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <DashboardWidgetHeaderIcon icon={PieChartIcon} />
      <span className="app-label">Top Budgets</span>
      <FxStatusTooltip
        fxStatus={fxStatus}
        label="Top budgets FX status"
        placement="bottom"
        getMessage={getTopBudgetsFxStatusMessage}
      />
    </div>
  )
}

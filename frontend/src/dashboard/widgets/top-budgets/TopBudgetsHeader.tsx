import { PieChart as PieChartIcon } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import BudgetFxStatusTooltip from '@/budgets/components/shared/BudgetFxStatusTooltip'
import { getTopBudgetsFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'

type TopBudgetsHeaderProps = {
  fxStatus: FxStatus
}

/**
 * Renders the top budgets label and combined foreign exchange status
 */
export function TopBudgetsHeader({ fxStatus }: TopBudgetsHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
        <PieChartIcon size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
      </div>
      <span className="app-label">Top Budgets</span>
      <BudgetFxStatusTooltip
        fxStatus={fxStatus}
        label="Top budgets FX status"
        placement="bottom"
        getMessage={getTopBudgetsFxStatusMessage}
      />
    </div>
  )
}

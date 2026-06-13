import { BarChart3 } from 'lucide-react'
import type { SpendingRange } from '@/api/dashboard'
import type { FxStatus } from '@/api/shared/fx'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import { FxStatusTooltip } from '@/components/FxStatusTooltip'
import { DashboardRangeSelector } from '@/pages/dashboard/components/DashboardRangeSelector'
import { DashboardWidgetHeaderIcon } from '@/pages/dashboard/components/DashboardWidgetHeaderIcon'
import {
  DASHBOARD_RANGE_SELECT_OPTIONS,
  PREVIOUS_PERIOD_LABEL_BY_RANGE,
} from '@/pages/dashboard/constants/ranges'
import { getSpendingComparisonFxStatusMessage } from '@/utils/fxTooltipMessages'

type SpendingComparisonHeaderProps = {
  spendingRange: SpendingRange
  fxStatus: FxStatus | undefined
  onRangeChange: (range: SpendingRange) => void
}

/**
 * Renders the spending comparison title, FX status, and responsive range controls
 */
export function SpendingComparisonHeader({
  spendingRange,
  fxStatus,
  onRangeChange,
}: SpendingComparisonHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <DashboardWidgetHeaderIcon icon={BarChart3} />
      <span className="app-label inline-flex items-baseline whitespace-nowrap">
        Spending vs. Last&nbsp;
        <AppSlotMachineText text={PREVIOUS_PERIOD_LABEL_BY_RANGE[spendingRange]} />
      </span>
      <FxStatusTooltip
        label="Spending comparison FX status"
        fxStatus={fxStatus}
        getMessage={getSpendingComparisonFxStatusMessage}
      />
      <DashboardRangeSelector
        value={spendingRange}
        options={DASHBOARD_RANGE_SELECT_OPTIONS}
        onChange={onRangeChange}
        ariaLabel="Spending range"
        sheetTitle="Spending range"
      />
    </div>
  )
}

import { PieChart as PieChartIcon, Repeat } from 'lucide-react'
import type { SpendingRange } from '@/api/dashboard'
import type { FxStatus } from '@/api/shared/fx'
import { AppSlotMachineText } from '@/components/display/AppSlotMachineText'
import { FxStatusTooltip } from '@/components/tooltips/FxStatusTooltip'
import { DashboardRangeSelector } from '@/pages/dashboard/components/DashboardRangeSelector'
import { DashboardWidgetHeaderIcon } from '@/pages/dashboard/components/DashboardWidgetHeaderIcon'
import { DASHBOARD_RANGE_SELECT_OPTIONS } from '@/pages/dashboard/constants/ranges'
import { getBreakdownFxStatusMessage } from '@/utils/fxTooltipMessages'
import type { BreakdownMode } from '@/pages/dashboard/utils/getSpendingBreakdownSummary'

type SpendingBreakdownHeaderProps = {
  breakdownMode: BreakdownMode
  breakdownRange: SpendingRange
  fxStatus: FxStatus | undefined
  onModeToggle: () => void
  onRangeChange: (range: SpendingRange) => void
}

/**
 * Renders the breakdown title, mode toggle, FX status, and responsive range controls
 */
export function SpendingBreakdownHeader({
  breakdownMode,
  breakdownRange,
  fxStatus,
  onModeToggle,
  onRangeChange,
}: SpendingBreakdownHeaderProps) {
  const oppositeModeLabel = breakdownMode === 'spending' ? 'income' : 'spending'

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <DashboardWidgetHeaderIcon icon={PieChartIcon} />
      <span className="app-label inline-flex items-baseline whitespace-nowrap">
        <AppSlotMachineText text={breakdownMode === 'spending' ? 'Spending' : 'Income'} />
        <span className="ml-[0.25em]">Breakdown</span>
      </span>
      <FxStatusTooltip
        label="Spending breakdown FX status"
        fxStatus={fxStatus}
        getMessage={(status) => getBreakdownFxStatusMessage(status, breakdownMode)}
      />
      <button
        type="button"
        onClick={onModeToggle}
        title={`Show ${oppositeModeLabel} breakdown`}
        aria-label={`Show ${oppositeModeLabel} breakdown`}
        className="app-icon-button ml-auto"
      >
        <Repeat size={12} />
      </button>
      <DashboardRangeSelector
        value={breakdownRange}
        options={DASHBOARD_RANGE_SELECT_OPTIONS}
        onChange={onRangeChange}
        ariaLabel="Breakdown range"
        sheetTitle="Breakdown range"
        desktopClassName="hidden min-[730px]:inline-flex"
      />
    </div>
  )
}

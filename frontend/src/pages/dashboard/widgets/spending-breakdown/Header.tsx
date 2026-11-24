import { PieChart as PieChartIcon, Repeat } from 'lucide-react'
import type { SpendingRange } from '@/api/dashboard'
import type { FxStatus } from '@/api/shared/fx'
import { AppSlotMachineText } from '@/components/display/SlotMachineText'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { HintButton } from '@/components/tooltips/HintButton'
import { DashboardRangeSelector } from '@/pages/dashboard/components/RangeSelector'
import { DashboardWidgetHeaderIcon } from '@/pages/dashboard/components/WidgetHeaderIcon'
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

  // The desktop tabs show only where the viewport is 730px or wider, as on every dashboard card, and the row holds the
  // icon (32px), title (169.3px), FX badge (FX_BADGE_WIDTH_PX, 20.27px), toggle (32px) and tabs (174px) with four 8px
  // gaps, 459.6px measured, rounded up to 461px to leave a pixel for the title's rounding. The badge is counted whether
  // or not it has arrived, so its late arrival never wraps the row. Narrower, or on a viewport under 730px, the mobile
  // selector takes its own row below the other four. Those four stay on one line
  return (
    <div data-testid="spending-breakdown-header" className="@container mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <DashboardWidgetHeaderIcon icon={PieChartIcon} />
        <span className="app-label inline-flex items-baseline whitespace-nowrap">
          <AppSlotMachineText text={breakdownMode === 'spending' ? 'Spending' : 'Income'} />
          <span className="ml-[0.25em]">breakdown</span>
        </span>
        <FxStatusBadge
          label="Spending breakdown FX status"
          fxStatus={fxStatus}
          getMessage={(status) => getBreakdownFxStatusMessage(status, breakdownMode)}
        />
        <HintButton
          onClick={onModeToggle}
          hint={`Show ${oppositeModeLabel} breakdown`}
          aria-label={`Show ${oppositeModeLabel} breakdown`}
          className="app-icon-button ml-auto"
        >
          <Repeat size={12} />
        </HintButton>
        <DashboardRangeSelector
          value={breakdownRange}
          options={DASHBOARD_RANGE_SELECT_OPTIONS}
          onChange={onRangeChange}
          ariaLabel="Breakdown range"
          sheetTitle="Breakdown range"
          desktopClassName="hidden min-[730px]:@[461px]:inline-flex"
          mobileClassName="w-full min-[730px]:@[461px]:hidden"
        />
      </div>
    </div>
  )
}

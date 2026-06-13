import { PieChart as PieChartIcon, Repeat } from 'lucide-react'
import type { SpendingRange } from '@/api/dashboard'
import type { FxStatus } from '@/api/shared/fx'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import IconTooltip from '@/components/IconTooltip'
import { TimeRangeSelector } from '@/components/TimeRangeSelector'
import { DASHBOARD_RANGE_SELECT_OPTIONS } from '@/dashboard/constants/ranges'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getBreakdownFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'
import type { BreakdownMode } from '@/dashboard/utils/getSpendingBreakdownSummary'

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
      <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
        <PieChartIcon size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
      </div>
      <span className="app-label inline-flex items-baseline whitespace-nowrap">
        <AppSlotMachineText text={breakdownMode === 'spending' ? 'Spending' : 'Income'} />
        <span className="ml-[0.25em]">Breakdown</span>
      </span>
      {fxStatus && (
        <IconTooltip
          label="Spending breakdown FX status"
          icon="fx"
          fxTone={getFxStatusTone(fxStatus)}
          placement="top"
        >
          <span className="block">{getBreakdownFxStatusMessage(fxStatus, breakdownMode)}</span>
          {fxStatus.missing_pairs.length > 0 && (
            <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
            </span>
          )}
        </IconTooltip>
      )}
      <button
        type="button"
        onClick={onModeToggle}
        title={`Show ${oppositeModeLabel} breakdown`}
        aria-label={`Show ${oppositeModeLabel} breakdown`}
        className="app-icon-button ml-auto"
      >
        <Repeat size={12} />
      </button>
      <TimeRangeSelector
        value={breakdownRange}
        options={DASHBOARD_RANGE_SELECT_OPTIONS}
        onChange={onRangeChange}
        ariaLabel="Breakdown range"
        className="hidden min-[730px]:inline-flex"
      />
      <TimeRangeSelector
        value={breakdownRange}
        options={DASHBOARD_RANGE_SELECT_OPTIONS}
        onChange={onRangeChange}
        ariaLabel="Breakdown range"
        variant="mobile"
        className="w-full min-[730px]:hidden"
        sheetTitle="Breakdown range"
      />
    </div>
  )
}

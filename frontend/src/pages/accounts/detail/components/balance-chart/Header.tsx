import { TimeRangeSelector, type TimeRangeSelectorOption } from '@/components/time-range/Selector'
import { BalanceChartModeSelector } from '@/pages/accounts/detail/components/BalanceChartModeSelector'
import type {
  BalanceChartMode,
  BalanceRange,
} from '@/pages/accounts/detail/constants/accountDetail'

const BALANCE_RANGE_OPTIONS: TimeRangeSelectorOption<BalanceRange>[] = [
  { value: '7D', label: '7D', description: 'Last 7 days' },
  { value: '30D', label: '30D', description: 'Last 30 days' },
  { value: '90D', label: '90D', description: 'Last 90 days' },
  { value: '1Y', label: '1Y', description: 'Last year' },
]

type BalanceChartHeaderProps = {
  range: BalanceRange
  chartMode: BalanceChartMode
  onRangeChange: (range: BalanceRange) => void
  onChartModeChange: (mode: BalanceChartMode) => void
}

/**
 * Renders balance chart title, mode selector, and range controls
 */
export function BalanceChartHeader({
  range,
  chartMode,
  onRangeChange,
  onChartModeChange,
}: BalanceChartHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="app-label">Current Balance</p>
      <BalanceChartModeSelector
        value={chartMode}
        onChange={onChartModeChange}
        className="w-[9.5rem] shrink-0 min-[750px]:hidden"
      />
      <div className="ml-auto hidden items-center gap-2 min-[750px]:flex">
        <BalanceChartModeSelector value={chartMode} onChange={onChartModeChange} className="w-[9.5rem]" />
        <TimeRangeSelector
          value={range}
          options={BALANCE_RANGE_OPTIONS}
          onChange={onRangeChange}
          ariaLabel="Balance range"
        />
      </div>
      <TimeRangeSelector
        value={range}
        options={BALANCE_RANGE_OPTIONS}
        onChange={onRangeChange}
        ariaLabel="Balance range"
        variant="mobile"
        className="w-full min-[750px]:hidden"
        sheetTitle="Balance range"
      />
    </div>
  )
}

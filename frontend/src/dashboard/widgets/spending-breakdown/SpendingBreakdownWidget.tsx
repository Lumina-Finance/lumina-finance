import { useMemo, useState } from 'react'
import {
  type SpendingRange,
  useSpendingBreakdown,
} from '@/api/dashboard'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { SpendingBreakdownChart } from './SpendingBreakdownChart'
import { SpendingBreakdownHeader } from './SpendingBreakdownHeader'
import { SpendingBreakdownLegend } from './SpendingBreakdownLegend'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import {
  getSpendingBreakdownSummary,
  type BreakdownMode,
} from '@/dashboard/utils/getSpendingBreakdownSummary'

type SpendingBreakdownWidgetProps = {
  displayCurrency: string
}

/**
 * Loads spending breakdown data and composes the active range, mode, chart, and legend
 */
export function SpendingBreakdownWidget({ displayCurrency }: SpendingBreakdownWidgetProps) {
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('spending')
  const [breakdownRange, setBreakdownRange] = useState<SpendingRange>('MTD')
  const { data: incomingSpendingBreakdown, isFetching: spendingBreakdownLoading } = useSpendingBreakdown(breakdownRange)
  const loadingSnapshot = useMemo(
    () => ({ spendingBreakdown: incomingSpendingBreakdown }),
    [incomingSpendingBreakdown],
  )
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: loadingSnapshot,
    loading: spendingBreakdownLoading,
    transitionKey: breakdownRange,
  })
  const spendingBreakdown = displaySnapshot.spendingBreakdown
  const fxStatus = spendingBreakdown?.fx_status
  const breakdownSummary = useMemo(
    () => getSpendingBreakdownSummary(spendingBreakdown, breakdownMode, breakdownRange),
    [breakdownMode, breakdownRange, spendingBreakdown],
  )
  const {
    entries: breakdownEntries,
    total: breakdownTotal,
    chartKey: breakdownChartKey,
  } = breakdownSummary

  return (
    <div className="app-card h-[470px] flex flex-col">
      <SpendingBreakdownHeader
        breakdownMode={breakdownMode}
        breakdownRange={breakdownRange}
        fxStatus={fxStatus}
        onModeToggle={() => setBreakdownMode((mode) => (mode === 'spending' ? 'income' : 'spending'))}
        onRangeChange={setBreakdownRange}
      />

      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading spending breakdown"
        className="flex-1"
        contentClassName="flex h-full min-h-0 flex-col"
      >
        {breakdownEntries.length === 0 ? (
          <div
            className="flex flex-1 items-center justify-center text-sm italic max-[1000px]:text-[0.7875rem]"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            No {breakdownMode === 'spending' ? 'expense' : 'income'} activity in this range
          </div>
        ) : (
          <>
            <SpendingBreakdownChart
              entries={breakdownEntries}
              total={breakdownTotal}
              chartKey={breakdownChartKey}
              breakdownMode={breakdownMode}
              displayCurrency={displayCurrency}
              summary={breakdownSummary}
              shouldReduceMotion={shouldReduceMotion}
            />
            <SpendingBreakdownLegend
              entries={breakdownEntries}
              breakdownMode={breakdownMode}
              summary={breakdownSummary}
            />
          </>
        )}
      </DashboardWidgetLoadingBody>
    </div>
  )
}

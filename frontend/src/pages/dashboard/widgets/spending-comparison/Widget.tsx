import { useMemo, useState } from 'react'
import {
  type SpendingRange,
  useSpendingComparison,
} from '@/api/dashboard'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/pages/dashboard/components/WidgetLoadingBody'
import { SpendingComparisonChart } from './Chart'
import { SpendingComparisonHeader } from './Header'
import { SpendingComparisonLegend } from './Legend'
import { SpendingComparisonMetric } from './Metric'
import { getSpendingComparisonSummary } from '@/pages/dashboard/utils/getSpendingComparisonSummary'

type SpendingComparisonWidgetProps = {
  displayCurrency: string
}

/**
 * Loads spending comparison data and composes the range controls, metric, legend, and chart
 */
export function SpendingComparisonWidget({ displayCurrency }: SpendingComparisonWidgetProps) {
  const [spendingRange, setSpendingRange] = useState<SpendingRange>('MTD')
  const { data: incomingSpendingComparison, isFetching: spendingComparisonLoading } = useSpendingComparison(spendingRange)
  const loadingSnapshot = useMemo(
    () => ({
      spendingComparison: incomingSpendingComparison,
      spendingRange,
    }),
    [incomingSpendingComparison, spendingRange],
  )
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: loadingSnapshot,
    loading: spendingComparisonLoading,
    transitionKey: spendingRange,
  })
  const { spendingComparison, spendingRange: displaySpendingRange } = displaySnapshot
  const fxStatus = spendingComparison?.fx_status
  const {
    spendingChartData,
    spendingXAxisTicks,
    firstSpendingXAxisTick,
    lastSpendingXAxisTick,
    spendingPointsByLabel,
    currentHasData,
    previousHasData,
    spentToDate,
    spendingDeltaPct,
    spendingDeltaText,
  } = useMemo(
    () => getSpendingComparisonSummary(spendingComparison, displaySpendingRange),
    [displaySpendingRange, spendingComparison],
  )
  return (
    <div className="app-card h-[470px] flex flex-col">
      <SpendingComparisonHeader
        spendingRange={spendingRange}
        fxStatus={fxStatus}
        onRangeChange={setSpendingRange}
      />
      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading spending comparison"
        className="flex-1"
        contentClassName="flex h-full min-h-0 flex-col"
      >
        <SpendingComparisonMetric
          spentToDate={spentToDate}
          spendingDeltaPct={spendingDeltaPct}
          spendingDeltaText={spendingDeltaText}
          displayCurrency={displayCurrency}
        />
        <SpendingComparisonLegend
          spendingRange={displaySpendingRange}
          currentHasData={currentHasData}
          previousHasData={previousHasData}
        />
        <SpendingComparisonChart
          data={spendingChartData}
          pointsByLabel={spendingPointsByLabel}
          xAxisTicks={spendingXAxisTicks}
          firstXAxisTick={firstSpendingXAxisTick}
          lastXAxisTick={lastSpendingXAxisTick}
          displayCurrency={displayCurrency}
          spendingRange={displaySpendingRange}
        />
      </DashboardWidgetLoadingBody>
    </div>
  )
}

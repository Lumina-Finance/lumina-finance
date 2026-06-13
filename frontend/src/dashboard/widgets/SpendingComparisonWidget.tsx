import { useMemo, useState } from 'react'
import {
  type SpendingRange,
  useSpendingComparison,
} from '@/api/dashboard'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { SpendingComparisonChart } from '@/dashboard/components/SpendingComparisonChart'
import { SpendingComparisonHeader } from '@/dashboard/components/SpendingComparisonHeader'
import { SpendingComparisonLegend } from '@/dashboard/components/SpendingComparisonLegend'
import { SpendingComparisonMetric } from '@/dashboard/components/SpendingComparisonMetric'
import { getSpendingComparisonSummary } from '@/dashboard/utils/getSpendingComparisonSummary'

type SpendingComparisonWidgetProps = {
  displayCurrency: string
}

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

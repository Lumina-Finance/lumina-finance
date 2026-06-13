import { useMemo, useState } from 'react'
import {
  type SpendingRange,
  useSpendingComparison,
} from '@/api/dashboard'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { SpendingComparisonChart } from '@/dashboard/components/SpendingComparisonChart'
import { SpendingComparisonHeader } from '@/dashboard/components/SpendingComparisonHeader'
import { SpendingComparisonMetric } from '@/dashboard/components/SpendingComparisonMetric'
import {
  CURRENT_LABEL_BY_RANGE,
  PREVIOUS_LABEL_BY_RANGE,
} from '@/dashboard/constants/ranges'
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
        <div className="mb-2 mt-2 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background: 'var(--app-accent)',
                opacity: currentHasData ? 1 : 0.4,
              }}
            />
            <span
              className="text-xs max-[1000px]:text-[0.675rem]"
              style={{
                color: 'var(--app-text-muted)',
                fontStyle: currentHasData ? 'normal' : 'italic',
              }}
            >
              {currentHasData
                ? CURRENT_LABEL_BY_RANGE[displaySpendingRange]
                : `No data for ${CURRENT_LABEL_BY_RANGE[displaySpendingRange].toLowerCase()}`}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background: 'var(--app-text-muted)',
                opacity: previousHasData ? 1 : 0.4,
              }}
            />
            <span
              className="text-xs max-[1000px]:text-[0.675rem]"
              style={{
                color: 'var(--app-text-muted)',
                fontStyle: previousHasData ? 'normal' : 'italic',
              }}
            >
              {previousHasData
                ? PREVIOUS_LABEL_BY_RANGE[displaySpendingRange]
                : `No data for ${PREVIOUS_LABEL_BY_RANGE[displaySpendingRange].toLowerCase()}`}
            </span>
          </div>
        </div>
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

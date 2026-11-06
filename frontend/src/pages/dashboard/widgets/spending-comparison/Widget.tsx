import { useEffect, useMemo, useState } from 'react'
import { useToast } from '@/hooks/useToast'
import { type SpendingRange, useSpendingComparison, useSpendingComparisonAverage } from '@/api/dashboard'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import { isLoadingFirstAnswer } from '@/utils/queryLoading'
import { DashboardWidgetLoadingBody } from '@/pages/dashboard/components/WidgetLoadingBody'
import { SpendingComparisonAverageToggle } from './AverageToggle'
import { SpendingComparisonChart } from './Chart'
import { SpendingComparisonHeader } from './Header'
import { SpendingComparisonLegend } from './Legend'
import { SpendingComparisonMetric } from './Metric'
import { PREVIOUS_PERIOD_LABEL_BY_RANGE } from '@/pages/dashboard/constants/ranges'
import { useSpendingAverageToggle } from '@/pages/dashboard/hooks/useSpendingAverageToggle'
import type { SpendingComparisonBasis } from '@/pages/dashboard/types/dashboard'
import { getSpendingComparisonSummary } from '@/pages/dashboard/utils/getSpendingComparisonSummary'
import { AVERAGE_FAILED_MESSAGE } from '@/pages/dashboard/utils/spendingAverageToggle'

type SpendingComparisonWidgetProps = {
  displayCurrency: string
}

/**
 * Loads spending comparison data and composes the range controls, metric, legend, and chart
 */
export function SpendingComparisonWidget({ displayCurrency }: SpendingComparisonWidgetProps) {
  const [spendingRange, setSpendingRange] = useState<SpendingRange>('MTD')
  const averageToggle = useSpendingAverageToggle()
  // The range whose average the card waits for before it shows: the one it opens on when the average is kept
  // on, and a range last changed to with the average on
  const [heldRange, setHeldRange] = useState<SpendingRange | null>(() => (averageToggle.on ? spendingRange : null))
  const spendingComparisonQuery = useSpendingComparison(spendingRange)
  // The earlier periods and their rates load only while the average is on. The card waits for them and
  // fails with them, so it never shows the previous period first and then jumps to the average
  const averageQuery = useSpendingComparisonAverage(spendingRange, averageToggle.on)
  const { data: baseSpendingComparison } = spendingComparisonQuery
  const averageData =
    averageToggle.on && averageQuery.data?.range === baseSpendingComparison?.range ? averageQuery.data : undefined
  const incomingSpendingComparison = useMemo(
    () =>
      baseSpendingComparison && averageData
        ? {
            ...baseSpendingComparison,
            average_sums: averageData.average_sums,
            average_counts: averageData.average_counts,
            average_fx_status: averageData.average_fx_status,
          }
        : baseSpendingComparison,
    [averageData, baseSpendingComparison],
  )
  // A range changed with the average on holds the card until the average has answered, so the previous
  // period never shows first. Turning the average on in the range already shown does not hold it, so
  // the toggle stays where it is to be pressed again
  const averageHeld = heldRange === spendingRange && averageToggle.on && isLoadingFirstAnswer(averageQuery)
  // A history that could not load leaves the previous period on show and the toggle reading off, which a
  // press tries again
  // One that only failed to refresh an average already on show leaves it as it is
  const averageFailed = averageToggle.on && averageQuery.isError && averageQuery.data === undefined
  // The toggle reads off and the card shows the previous period, so a toast says why, once for each failed
  // attempt, where a touch screen and a screen reader also get it. The toggle's tooltip says it again on hover
  const { showToast } = useToast()
  const averageErrorAt = averageQuery.errorUpdatedAt
  useEffect(() => {
    if (averageFailed && averageErrorAt > 0) showToast({ status: 'error', text: AVERAGE_FAILED_MESSAGE })
  }, [averageFailed, averageErrorAt, showToast])
  const spendingComparisonFailed = spendingComparisonQuery.isError
  const spendingComparisonError = spendingComparisonQuery.error
  const spendingComparisonLoading = isLoadingFirstAnswer(spendingComparisonQuery) || averageHeld
  const loadingSnapshot = useMemo(
    () => ({
      spendingComparison: incomingSpendingComparison,
      spendingRange,
      averageAnswered: averageData !== undefined,
    }),
    [averageData, incomingSpendingComparison, spendingRange],
  )
  const { displaySnapshot, contentConcealed, loadingVisible, shouldReduceMotion } = useLoadingSnapshot({
    snapshot: loadingSnapshot,
    loading: spendingComparisonLoading,
    transitionKey: spendingRange,
  })
  const { spendingComparison, spendingRange: displaySpendingRange, averageAnswered } = displaySnapshot
  // Periods with no spending are left out of the average, so how many it was worked out from is known only
  // once it has loaded, and an average that has loaded from none has nothing to show
  const averagePeriods = spendingComparison?.average_periods ?? 0
  const averagePeriodsUsed = averageAnswered ? (spendingComparison?.average_counts[0] ?? 0) : null
  const averageEmpty = averagePeriods > 0 && averagePeriodsUsed === 0
  const averageAvailable = averagePeriods > 0 && !averageEmpty
  const fxStatus = spendingComparison?.fx_status
  const basis: SpendingComparisonBasis =
    averageToggle.on && (spendingComparison?.average_counts.length ?? 0) > 0 ? 'average' : 'previous'
  const {
    spendingChartData,
    spendingXAxisTicks,
    firstSpendingXAxisTick,
    lastSpendingXAxisTick,
    spendingPointsByLabel,
    currentHasData,
    comparisonHasData,
    spentToDate,
    spendingDeltaPct,
    spendingDeltaText,
  } = useMemo(
    () => getSpendingComparisonSummary(spendingComparison, displaySpendingRange, basis),
    [basis, displaySpendingRange, spendingComparison],
  )

  // The reason is only known once the range has answered, so a switch or a failure never claims there is
  // no history. A range without one, or whose earlier periods all held no spending, falls back to the
  // previous period whatever the toggle holds
  const averageUnit = PREVIOUS_PERIOD_LABEL_BY_RANGE[displaySpendingRange]
  const averageDisabledReason =
    spendingComparison && !spendingComparisonLoading && !spendingComparisonFailed && !averageAvailable
      ? averageEmpty
        ? `No spending in the whole ${averageUnit}s before this one to average.`
        : `Needs one whole ${averageUnit} of history before this one.`
      : null
  return (
    <div className="app-card h-[470px] flex flex-col">
      <SpendingComparisonHeader
        spendingRange={spendingRange}
        fxStatus={fxStatus}
        averageFxStatus={spendingComparison?.average_fx_status}
        showAverage={basis === 'average'}
        onRangeChange={(range) => {
          setSpendingRange(range)
          setHeldRange(averageToggle.on ? range : null)
        }}
      />
      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        error={spendingComparisonError}
        failed={spendingComparisonFailed}
        subject="Spending comparison"
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading spending comparison"
        className="-mx-4 flex-1 px-4"
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
          basis={basis}
          currentHasData={currentHasData}
          comparisonHasData={comparisonHasData}
        >
          <SpendingComparisonAverageToggle
            on={averageToggle.on && !averageFailed}
            kept={averageToggle.kept}
            disabledReason={averageDisabledReason}
            range={displaySpendingRange}
            failed={averageFailed}
            onClick={() => {
              setHeldRange(null)
              // The toggle reads off while the history has failed, so a press asks for it again
              if (averageFailed) void averageQuery.refetch()
              else averageToggle.click()
            }}
            onLongPress={() => {
              setHeldRange(null)
              if (averageFailed) void averageQuery.refetch()
              averageToggle.longPress()
            }}
          />
        </SpendingComparisonLegend>
        <SpendingComparisonChart
          data={spendingChartData}
          pointsByLabel={spendingPointsByLabel}
          xAxisTicks={spendingXAxisTicks}
          firstXAxisTick={firstSpendingXAxisTick}
          lastXAxisTick={lastSpendingXAxisTick}
          displayCurrency={displayCurrency}
          spendingRange={displaySpendingRange}
          basis={basis}
        />
      </DashboardWidgetLoadingBody>
    </div>
  )
}

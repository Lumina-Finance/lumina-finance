import type { SpendingComparisonResponse, SpendingRange } from '@/api/dashboard'
import type { SpendingComparisonSeriesPoint } from '@/pages/dashboard/types/dashboard'
import { formatMovedPercent } from '@/utils/negativeAmount'
import { getRoundedPercent } from '@/utils/rounding'
import { getSpendingComparisonSeries } from '@/pages/dashboard/utils/getSpendingComparisonSeries'

export type SpendingComparisonSummary = {
  spendingChartData: SpendingComparisonSeriesPoint[]
  spendingXAxisTicks: string[]
  firstSpendingXAxisTick: string | undefined
  lastSpendingXAxisTick: string | undefined
  spendingPointsByLabel: Map<string, SpendingComparisonSeriesPoint>
  currentHasData: boolean
  previousHasData: boolean
  spentToDate: number
  spendingDeltaPct: number | null
  spendingDeltaText: string
}

/**
 * Keeps dense month-to-date labels readable by labelling every other day and always the last day
 * The last label is end-aligned and the others are centred, so a label only two days before it
 * touches it on a phone, and the labels within two days of the last are dropped
 */
function getSpendingComparisonXAxisTicks(
  range: SpendingRange,
  data: Array<{ label: string }>,
) {
  const labels = data.map((point) => point.label)
  if (range === 'MTD') {
    const lastIndex = labels.length - 1
    return labels.filter((_, index) => (
      index === lastIndex || (index % 2 === 0 && lastIndex - index >= 3)
    ))
  }

  return labels
}

/**
 * Compares current cumulative spending with the previous period at the same available offset, as a
 * percent to the tenth that rounds up, so spending never reads as growing less or shrinking more than
 * it did
 */
function getSpendingComparisonDeltaPct(currentSeries: number[], previousSeries: number[]) {
  const spentToDate = currentSeries.at(-1) ?? 0
  const previousAtSameOffset =
    currentSeries.length === 0
      ? null
      : previousSeries[Math.min(currentSeries.length, previousSeries.length) - 1] ?? null

  return previousAtSameOffset != null && previousAtSameOffset > 0
    ? getRoundedPercent(spentToDate - previousAtSameOffset, previousAtSameOffset, 'up', 1)
    : null
}

/**
 * Derives chart series, legend state, and comparison deltas for the spending comparison widget
 */
export function getSpendingComparisonSummary(
  spendingComparison: SpendingComparisonResponse | undefined,
  spendingRange: SpendingRange,
): SpendingComparisonSummary {
  const spendingChartData = getSpendingComparisonSeries(spendingComparison)
  const spendingXAxisTicks = getSpendingComparisonXAxisTicks(spendingRange, spendingChartData)
  const currentSeries = spendingComparison?.current ?? []
  const previousSeries = spendingComparison?.previous ?? []
  const spendingDeltaPct = getSpendingComparisonDeltaPct(currentSeries, previousSeries)

  return {
    spendingChartData,
    spendingXAxisTicks,
    firstSpendingXAxisTick: spendingXAxisTicks[0],
    lastSpendingXAxisTick: spendingXAxisTicks[spendingXAxisTicks.length - 1],
    spendingPointsByLabel: new Map(spendingChartData.map((point) => [point.label, point])),
    currentHasData: currentSeries.some((value) => value > 0),
    previousHasData: previousSeries.some((value) => value > 0),
    spentToDate: currentSeries.at(-1) ?? 0,
    spendingDeltaPct,
    spendingDeltaText: spendingDeltaPct == null
      ? '+00.0%'
      : formatMovedPercent(spendingDeltaPct, 1),
  }
}

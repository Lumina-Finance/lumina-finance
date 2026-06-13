import type { SpendingComparisonResponse, SpendingRange } from '@/api/dashboard'
import type { SpendingComparisonSeriesPoint } from '@/dashboard/types/dashboard'
import { getSpendingComparisonSeries } from '@/dashboard/utils/getSpendingComparisonSeries'

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
 * Keeps dense month-to-date labels readable while preserving every other range label
 */
function getSpendingComparisonXAxisTicks(
  range: SpendingRange,
  data: Array<{ label: string }>,
) {
  const labels = data.map((point) => point.label)
  if (range === 'MTD') {
    return labels.filter((_, index) => (
      index % 2 === 0 || index === labels.length - 1
    ))
  }

  return labels
}

/**
 * Compares current cumulative spending with the previous period at the same available offset
 */
function getSpendingComparisonDeltaPct(currentSeries: number[], previousSeries: number[]) {
  const spentToDate = currentSeries.at(-1) ?? 0
  const previousAtSameOffset =
    currentSeries.length === 0
      ? null
      : previousSeries[Math.min(currentSeries.length, previousSeries.length) - 1] ?? null

  return previousAtSameOffset != null && previousAtSameOffset > 0
    ? ((spentToDate - previousAtSameOffset) / previousAtSameOffset) * 100
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
      : `${spendingDeltaPct >= 0 ? '+' : ''}${spendingDeltaPct.toFixed(1)}%`,
  }
}

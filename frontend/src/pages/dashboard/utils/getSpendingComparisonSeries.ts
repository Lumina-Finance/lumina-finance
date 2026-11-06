import type { SpendingComparisonResponse } from '@/api/dashboard'
import type { SpendingComparisonSeriesPoint } from '@/pages/dashboard/types/dashboard'
import { divideRounded } from '@/utils/rounding'

/**
 * Works out each slot's average spending from the sums and counts the backend sends, rounded up to
 * the minor unit since an expense figure never reads lower than it is
 */
export function getSpendingAverageSeries(spendingComparison: SpendingComparisonResponse | undefined): number[] {
  if (!spendingComparison) return []

  const { average_sums, average_counts } = spendingComparison
  return average_sums.map((sum, index) => divideRounded(sum, average_counts[index], 'up'))
}

/**
 * Zips the full period labels with current, previous and average cumulative spending
 * Missing values become null so Recharts renders gaps rather than invented points
 */
export function getSpendingComparisonSeries(
  spendingComparison: SpendingComparisonResponse | undefined,
): SpendingComparisonSeriesPoint[] {
  if (!spendingComparison) return []

  const { slot_labels, current, previous } = spendingComparison
  const average = getSpendingAverageSeries(spendingComparison)

  // The x-axis always covers the full selected period. Current/previous arrays
  // may stop earlier, so missing points become null gaps in Recharts
  return slot_labels.map((label, index) => ({
    label,
    current: index < current.length ? current[index] : null,
    previous: index < previous.length ? previous[index] : null,
    average: index < average.length ? average[index] : null,
  }))
}

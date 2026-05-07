import type { SpendingComparisonResponse } from '@/api/dashboard'
import type { SpendingComparisonSeriesPoint } from '@/dashboard/types/dashboard'

/**
 * Zips the full period labels with current and previous cumulative spending.
 * Missing values become null so Recharts renders gaps rather than invented points.
 */
export function getSpendingComparisonSeries(
  spendingComparison: SpendingComparisonResponse | undefined,
): SpendingComparisonSeriesPoint[] {
  if (!spendingComparison) return []

  const { slot_labels, current, previous } = spendingComparison
  // The x-axis always covers the full selected period. Current/previous arrays
  // may stop earlier, so missing points become null gaps in Recharts.
  return slot_labels.map((label, index) => ({
    label,
    current: index < current.length ? current[index] : null,
    previous: index < previous.length ? previous[index] : null,
  }))
}

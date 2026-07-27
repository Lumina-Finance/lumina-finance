import type { InsightsSavingsRateTrendResponse } from '@/api/insights'
import type { SavingsRateHistoryPoint } from '@/pages/insights/types/savingsRate'
import { DATE_FORMATS, formatDate } from '@/utils/date'
import { getSavingsRate } from './money'

/**
 * Maps the savings rate trend response into chart points, computing each month's rate and
 * flagging the last row as the current, still in-progress month
 *
 * A month with no income reports a rate of negative infinity when it also had expenses, so the
 * chart can render it as a floor rather than an undefined gap, and null only when both are zero
 */
export function getSavingsRateHistory(
  response: InsightsSavingsRateTrendResponse | undefined,
): SavingsRateHistoryPoint[] {
  const rows = response?.points ?? []

  return rows.map(([monthKey, income, expenses], index) => {
    const month = new Date(`${monthKey}T00:00:00`)
    const rate = income > 0
      ? getSavingsRate(income, expenses)
      : expenses > 0
        ? Number.NEGATIVE_INFINITY
        : null
    const monthLabel = formatDate(month, DATE_FORMATS.month)

    return {
      monthKey,
      monthLabel,
      tickLabel: month.getMonth() === 0 ? `${monthLabel} '${String(month.getFullYear()).slice(2)}` : monthLabel,
      fullLabel: formatDate(month, DATE_FORMATS.longMonthYear),
      rate,
      income,
      expenses,
      isCurrent: index === rows.length - 1,
    }
  })
}

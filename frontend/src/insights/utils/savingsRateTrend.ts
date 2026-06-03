import type { InsightsSavingsRateTrendResponse } from '@/api/insights'
import type { SavingsRateHistoryPoint } from '../components/SavingsRateTrendCard'
import { getMonthLabel } from './date'
import { getSavingsRate } from './money'

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
    const monthLabel = getMonthLabel(month)

    return {
      monthKey,
      monthLabel,
      tickLabel: month.getMonth() === 0 ? `${monthLabel} '${String(month.getFullYear()).slice(2)}` : monthLabel,
      fullLabel: month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      rate,
      income,
      expenses,
      isCurrent: index === rows.length - 1,
    }
  })
}

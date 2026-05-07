import type { SavingsRateWidgetResponse } from '@/api/dashboard'
import type { SavingsRateSeriesPoint } from '@/dashboard/types/dashboard'

/**
 * Converts monthly income/expense rows into chart-ready savings-rate bars.
 * Expense-only months are plotted at -100 so the negative case remains visible.
 */
export function getSavingsRateSeries(
  dashboardSavingsRate: SavingsRateWidgetResponse | undefined,
): SavingsRateSeriesPoint[] {
  const history = dashboardSavingsRate?.savings_rate_history ?? []

  return history.map((row, index, rows) => {
    let rate: number | null
    // Null means no bar for months with no activity. Expense-only months are
    // plotted at -100 so the chart still communicates the negative case.
    if (row.income > 0) {
      rate = Math.round(((row.income - row.expenses) / row.income) * 100)
    } else if (row.expenses > 0) {
      rate = -100
    } else {
      rate = null
    }

    const monthDate = new Date(`${row.month}T00:00:00`)
    return {
      monthLabel: monthDate.toLocaleDateString('en-US', { month: 'short' }),
      fullLabel: monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      rate,
      income: row.income,
      expenses: row.expenses,
      isCurrent: index === rows.length - 1,
    }
  })
}

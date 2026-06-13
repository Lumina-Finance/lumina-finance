import type { SavingsRateSeriesPoint } from '@/pages/dashboard/types/dashboard'

export type SavingsRateChartPoint = SavingsRateSeriesPoint & {
  chartRate: number | null
}

export type SavingsRateTier = 'positive' | 'accent' | 'negative'

/**
 * Converts a savings rate into the colour tier used by the dashboard chart
 */
export function getSavingsRateTier(rate: number | null): SavingsRateTier {
  if (rate === null) return 'negative'
  if (rate >= 20) return 'positive'
  if (rate >= 10) return 'accent'
  return 'negative'
}

/**
 * Caps outlier savings rates so the optional bounded chart remains readable
 */
function clampSavingsRate(rate: number | null) {
  if (rate === null) return null
  return Math.max(-100, Math.min(100, rate))
}

/**
 * Treats any income or expense movement as visible chart activity
 */
function hasSavingsRateActivity(point: Pick<SavingsRateSeriesPoint, 'income' | 'expenses'>) {
  return point.income !== 0 || point.expenses !== 0
}

/**
 * Keeps the current period visible even when it has no income or expense activity yet
 */
function shouldShowSavingsRatePoint(point: SavingsRateSeriesPoint) {
  return point.isCurrent || hasSavingsRateActivity(point)
}

/**
 * Formats the tooltip savings rate while preserving the no-income negative infinity state
 */
export function getSavingsRateDisplay(point: SavingsRateChartPoint) {
  if (point.income === 0 && point.expenses === 0) return null
  return point.income > 0
    ? `${Math.round(((point.income - point.expenses) / point.income) * 100)}%`
    : '−∞%'
}

/**
 * Builds chart-ready savings rate points for the active bounded or unbounded display mode
 */
export function getSavingsRateChartData(
  savingsData: SavingsRateSeriesPoint[],
  capSavingsRateChart: boolean,
): SavingsRateChartPoint[] {
  return savingsData
    .filter(shouldShowSavingsRatePoint)
    .map((point) => ({
      ...point,
      chartRate: capSavingsRateChart ? clampSavingsRate(point.rate) : point.rate,
    }))
}

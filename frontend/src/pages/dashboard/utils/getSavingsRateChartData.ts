import type { SavingsRateSeriesPoint } from '@/components/charts/types'
import { formatRatePercent } from '@/utils/negativeAmount'
import { getSavingsRate } from '@/utils/savingsRate'

export type SavingsRateChartPoint = SavingsRateSeriesPoint & {
  chartRate: number | null
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
 * Formats the tooltip savings rate, which reads "N/A" for a month with expenses and no income to measure against
 */
export function getSavingsRateDisplay(point: SavingsRateChartPoint) {
  if (point.income === 0 && point.expenses === 0) return null
  const rate = getSavingsRate(point.income, point.expenses)
  return rate === null ? 'N/A' : formatRatePercent(rate)
}

/**
 * Builds chart-ready savings rate points for the active bounded or unbounded display mode
 */
export function getSavingsRateChartData(
  savingsData: SavingsRateSeriesPoint[],
  capSavingsRateChart: boolean,
): SavingsRateChartPoint[] {
  return savingsData.filter(shouldShowSavingsRatePoint).map((point) => ({
    ...point,
    chartRate: capSavingsRateChart ? clampSavingsRate(point.rate) : point.rate,
  }))
}

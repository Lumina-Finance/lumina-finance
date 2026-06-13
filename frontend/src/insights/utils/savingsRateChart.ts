import type { SavingsRateHistoryPoint } from '@/insights/types/savingsRate'

export type SavingsRateTier = 'positive' | 'accent' | 'negative'

export type SavingsRateSummary = {
  latestPoint: SavingsRateHistoryPoint | undefined
  averageRate: number | null
  bestPoint: SavingsRateHistoryPoint | null
  worstPoint: SavingsRateHistoryPoint | null
}

export type SavingsRateChartPoint = SavingsRateHistoryPoint & {
  chartRate: number | null
}

type SavingsRateAxisConfig = {
  domain: [number, number]
  ticks: number[]
  averageChartRate: number | null
}

function hasFiniteSavingsRate(point: SavingsRateHistoryPoint): point is SavingsRateHistoryPoint & { rate: number } {
  return point.rate !== null && Number.isFinite(point.rate)
}

function clampSavingsRate(rate: number | null) {
  if (rate === null) return null
  return Math.max(-100, Math.min(100, rate))
}

/**
 * Returns the display tier used by the savings-rate chart and legend
 */
export function getSavingsRateTier(rate: number | null): SavingsRateTier {
  if (rate === null) return 'negative'
  if (rate >= 20) return 'positive'
  if (rate > 0) return 'accent'
  return 'negative'
}

/**
 * Returns the chart value after preserving infinite rates as capped endpoints
 */
export function getSavingsRateChartRate(rate: number | null, capRates: boolean) {
  if (rate === null) return null
  if (!Number.isFinite(rate)) return rate < 0 ? -100 : 100
  return capRates ? clampSavingsRate(rate) : rate
}

/**
 * Summarises completed savings-rate history for the card header stats
 */
export function getSavingsRateSummary(series: SavingsRateHistoryPoint[]): SavingsRateSummary {
  const ratedPoints = series.filter((point) => point.rate !== null)
  const completedRatedPoints = ratedPoints.filter((point) => !point.isCurrent)
  const completedAveragePoints = completedRatedPoints.filter(hasFiniteSavingsRate)
  const averageRate = completedAveragePoints.length > 0
    ? Math.round(completedAveragePoints.reduce((sum, point) => sum + point.rate, 0) / completedAveragePoints.length)
    : null
  const bestPoint = completedRatedPoints.reduce<SavingsRateHistoryPoint | null>(
    (best, point) => (best === null || (point.rate ?? -Infinity) > (best.rate ?? -Infinity) ? point : best),
    null,
  )
  const worstPoint = completedRatedPoints.reduce<SavingsRateHistoryPoint | null>(
    (worst, point) => (worst === null || (point.rate ?? Infinity) < (worst.rate ?? Infinity) ? point : worst),
    null,
  )

  return {
    latestPoint: series.at(-1),
    averageRate,
    bestPoint,
    worstPoint,
  }
}

/**
 * Projects savings-rate history into the value shape consumed by the Recharts bars
 */
export function getSavingsRateChartPoints(
  series: SavingsRateHistoryPoint[],
  capRates: boolean,
): SavingsRateChartPoint[] {
  return series.map((point) => ({
    ...point,
    chartRate: getSavingsRateChartRate(point.rate, capRates),
  }))
}

/**
 * Builds the Y-axis domain and ticks around real savings-rate extrema
 */
export function getSavingsRateAxisConfig({
  chartPoints,
  averageRate,
  capRates,
}: {
  chartPoints: SavingsRateChartPoint[]
  averageRate: number | null
  capRates: boolean
}): SavingsRateAxisConfig {
  const chartRates = chartPoints
    .map((point) => point.chartRate)
    .filter((rate): rate is number => rate !== null)
  const averageChartRate = getSavingsRateChartRate(averageRate, capRates)
  const highestRate = chartRates.length > 0 ? Math.max(...chartRates) : 100
  const lowestRate = chartRates.length > 0 ? Math.min(...chartRates) : -100
  const hasPositiveRate = chartRates.some((rate) => rate > 0)
  const hasNegativeRate = chartRates.some((rate) => rate < 0)
  const hasFullRate = chartRates.some((rate) => rate >= 100)
  const showCappedPositiveSection = capRates && (hasPositiveRate || !hasNegativeRate)
  const showCappedNegativeSection = capRates && hasNegativeRate
  const domain: [number, number] = capRates
    ? [showCappedNegativeSection ? -100 : 0, showCappedPositiveSection ? 100 : 0]
    : [hasNegativeRate ? Math.min(-100, lowestRate) : 0, Math.max(highestRate, 0)]
  const ticks = Array.from(new Set(capRates ? [
    ...(showCappedNegativeSection ? [-100] : []),
    0,
    ...(showCappedPositiveSection ? [100] : []),
  ] : [
    ...(hasNegativeRate ? [-100] : []),
    lowestRate,
    ...(averageChartRate !== null ? [averageChartRate] : []),
    0,
    ...(hasFullRate ? [100] : []),
  ]))
    .filter((tick) => tick >= domain[0] && tick <= domain[1])
    .sort((a, b) => a - b)

  return {
    domain,
    ticks,
    averageChartRate,
  }
}

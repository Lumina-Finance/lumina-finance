import type { AccountBalanceSnapshot, SnapshotGranularity } from '@/api/accounts'
import {
  RANGE_CONFIG,
  type BalanceChartMode,
  type BalanceRange,
} from '@/pages/accounts/detail/constants/accountDetail'
import { getBalanceXAxisTicks } from '@/pages/accounts/detail/utils/balanceChartAxis'
import { calendarDateMs } from '@/pages/accounts/detail/utils/calendarDate'
import {
  buildChartSeries,
  rezeroSeriesToPeriod,
  type BalanceChartPoint,
} from '@/pages/accounts/detail/utils/balanceChartSeries'
import { getTodayDate } from '@/utils/date'

export type BalanceChartDataPoint = BalanceChartPoint & {
  periodBalance?: number
}

export type BalanceChartPeriodDelta = {
  absolute: number
  pct: number | null
}

export type BalanceChartSnapshot = {
  range: BalanceRange
  chartMode: BalanceChartMode
  currentBalance: number
  currency: string
  periodDelta: BalanceChartPeriodDelta | null
  trendUp: boolean
  deltaColor: string
  chartLineColor: string
  chartSeries: BalanceChartDataPoint[]
  chartDataKey: 'balance' | 'periodBalance'
  axisStartMs: number
  axisEndMs: number
  xAxisTicks: number[]
  seriesByDateMs: Map<number, BalanceChartPoint>
  yearBoundary: {
    dateMs: number
    year: string
  } | null
}

type BalanceRangeWindow = {
  fromDate: Date
  toDate: Date
  granularity: SnapshotGranularity
}

type BalanceChartSnapshotOptions = {
  snapshots: AccountBalanceSnapshot[]
  range: BalanceRange
  chartMode: BalanceChartMode
  currentBalance: number
  currency: string
  fromDate: Date
  toDate: Date
  granularity: SnapshotGranularity
}

/**
 * Derives the snapshot query window from the selected balance range
 *
 * The window has to be read in the profile's zone rather than the browser's, because the backend
 * computes each daily balance row on the account owner's own calendar date
 *
 * @param range - The selected range, deciding how many days the window spans
 * @param timeZone - Zone deciding where the window ends, typically the profile setting
 * @param now - Instant to read the day from, overridable so tests can pin it
 */
export function getBalanceRangeWindow(
  range: BalanceRange,
  timeZone: string | undefined,
  now = new Date(),
): BalanceRangeWindow {
  const config = RANGE_CONFIG[range]
  const toDate = getTodayDate(timeZone, now)
  const fromDate = new Date(toDate)
  fromDate.setDate(fromDate.getDate() - (config.days - 1))

  return {
    fromDate,
    toDate,
    granularity: config.granularity,
  }
}

/**
 * Computes first-to-last balance movement for the selected chart window
 */
export function getBalancePeriodDelta(series: BalanceChartPoint[]): BalanceChartPeriodDelta | null {
  if (series.length < 2) return null
  const start = series[0].balance
  const end = series[series.length - 1].balance
  const absolute = end - start
  const pct = start === 0 ? null : (absolute / Math.abs(start)) * 100
  return { absolute, pct }
}

/**
 * Finds the New Year marker when the selected balance window crosses into the current year
 */
export function getBalanceYearBoundary(fromDate: Date, toDate: Date) {
  const yearStart = new Date(toDate.getFullYear(), 0, 1)
  return fromDate < yearStart && yearStart <= toDate
    ? { dateMs: calendarDateMs(yearStart), year: String(toDate.getFullYear()) }
    : null
}

/**
 * Builds the render-ready balance chart snapshot used during loading transitions
 */
export function getBalanceChartSnapshot({
  snapshots,
  range,
  chartMode,
  currentBalance,
  currency,
  fromDate,
  toDate,
  granularity,
}: BalanceChartSnapshotOptions): BalanceChartSnapshot {
  const series = buildChartSeries(snapshots, fromDate, toDate, granularity)
  const periodSeries = rezeroSeriesToPeriod(series)
  const chartSeries = chartMode === 'balance' ? series : periodSeries
  const periodDelta = getBalancePeriodDelta(series)
  const trendUp = periodDelta !== null && periodDelta.absolute >= 0
  const lineColor = currentBalance < 0 ? 'var(--app-negative)' : 'var(--app-accent)'
  const deltaColor = periodDelta === null
    ? 'var(--app-text-muted)'
    : trendUp
      ? 'var(--app-positive)'
      : 'var(--app-negative)'

  return {
    range,
    chartMode,
    currentBalance,
    currency,
    periodDelta,
    trendUp,
    deltaColor,
    chartLineColor: chartMode === 'change' && periodDelta !== null ? deltaColor : lineColor,
    chartSeries,
    chartDataKey: chartMode === 'balance' ? 'balance' : 'periodBalance',
    axisStartMs: calendarDateMs(fromDate),
    axisEndMs: calendarDateMs(toDate),
    xAxisTicks: getBalanceXAxisTicks(fromDate, toDate, range),
    seriesByDateMs: new Map(series.map((point) => [point.dateMs, point])),
    yearBoundary: getBalanceYearBoundary(fromDate, toDate),
  }
}

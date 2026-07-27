import type { AccountBalanceSnapshot, SnapshotGranularity } from '@/api/accounts'
import { calendarDateMs } from './calendarDate'
import { DATE_FORMATS, formatDate, formatYmd } from '@/utils/date'

export interface BalanceChartPoint {
  date: string
  dateMs: number
  dateLabel: string
  tooltipLabel: string
  balance: number
}

export interface BalanceChartPeriodPoint extends BalanceChartPoint {
  periodBalance: number
}

function startOfLocalDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

function addMonthsClamped(d: Date, months: number): Date {
  const year = d.getFullYear()
  const month = d.getMonth() + months
  const day = d.getDate()
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, lastDay))
}

function advanceSample(d: Date, granularity: SnapshotGranularity): Date {
  const c = startOfLocalDay(d)
  if (granularity === 'day') c.setDate(c.getDate() + 1)
  else if (granularity === 'week') c.setDate(c.getDate() + 7)
  else if (granularity === 'month') return addMonthsClamped(c, 1)
  else return addMonthsClamped(c, 3)
  return c
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * Generates balance sample dates from the selected range while preserving exact range bounds
 */
function generateSampleDates(
  fromDate: Date,
  toDate: Date,
  granularity: SnapshotGranularity,
): Date[] {
  const start = startOfLocalDay(fromDate)
  const end = startOfLocalDay(toDate)
  if (start > end) return []

  const samples = [start]
  let cursor = advanceSample(start, granularity)
  while (cursor < end) {
    samples.push(cursor)
    cursor = advanceSample(cursor, granularity)
  }
  if (!sameCalendarDay(samples[samples.length - 1], end)) {
    samples.push(end)
  }
  return samples
}

/**
 * Builds one chart point per sample date using the latest snapshot at or before that date
 */
export function buildChartSeries(
  snapshots: AccountBalanceSnapshot[],
  fromDate: Date,
  toDate: Date,
  granularity: SnapshotGranularity,
): BalanceChartPoint[] {
  const sampleDates = generateSampleDates(fromDate, toDate, granularity)
  if (sampleDates.length === 0) return []

  const sorted = [...snapshots].sort((a, b) => a.dt.localeCompare(b.dt))

  // The pointer advances once through sorted snapshots so each sample uses the latest known balance
  let idx = 0
  let runningBalance = 0
  const points: BalanceChartPoint[] = []
  for (const sampleDate of sampleDates) {
    const sampleDateStr = formatYmd(sampleDate)
    while (idx < sorted.length && sorted[idx].dt <= sampleDateStr) {
      runningBalance = sorted[idx].balance
      idx++
    }
    points.push({
      date: sampleDateStr,
      dateMs: calendarDateMs(sampleDate),
      dateLabel: formatDate(sampleDate, DATE_FORMATS.monthDay),
      tooltipLabel: formatDate(sampleDate, DATE_FORMATS.monthDayYear),
      balance: runningBalance,
    })
  }

  return points
}

/**
 * Restates a balance series as the movement since its first point, so the chart can show how much
 * the account changed over the selected period rather than what it holds
 */
export function rezeroSeriesToPeriod(
  series: BalanceChartPoint[],
): BalanceChartPeriodPoint[] {
  if (series.length === 0) return []
  const baseline = series[0].balance
  return series.map((point) => ({
    ...point,
    periodBalance: point.balance - baseline,
  }))
}

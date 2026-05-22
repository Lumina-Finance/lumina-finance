import type { AccountBalanceSnapshot, SnapshotGranularity } from '@/api/accounts'
import { toISODate } from '@/accounts/detail/utils/date'

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

function calendarDateMs(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
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

// Generate balance sample dates from the selected range itself. The first and
// last points are always the exact range bounds; coarser ranges only reduce the
// interior sample cadence.
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

// Build the chart series: one point per selected sample date. Balance comes
// from the latest snapshot at or before that date. Sample dates with no
// preceding data render at 0.
export function buildChartSeries(
  snapshots: AccountBalanceSnapshot[],
  fromDate: Date,
  toDate: Date,
  granularity: SnapshotGranularity,
): BalanceChartPoint[] {
  const sampleDates = generateSampleDates(fromDate, toDate, granularity)
  if (sampleDates.length === 0) return []

  const sorted = [...snapshots].sort((a, b) => a.dt.localeCompare(b.dt))

  // Pointer walks through sorted snapshots as sample dates advance.
  // Samples before the first snapshot render at 0 (no data yet).
  let idx = 0
  let runningBalance = 0
  const points: BalanceChartPoint[] = []
  for (const sampleDate of sampleDates) {
    const sampleDateStr = toISODate(sampleDate)
    while (idx < sorted.length && sorted[idx].dt <= sampleDateStr) {
      runningBalance = sorted[idx].balance
      idx++
    }
    points.push({
      date: sampleDateStr,
      dateMs: calendarDateMs(sampleDate),
      dateLabel: sampleDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      tooltipLabel: sampleDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      balance: runningBalance,
    })
  }

  return points
}

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

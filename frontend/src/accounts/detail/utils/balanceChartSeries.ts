import type { AccountBalanceSnapshot, SnapshotGranularity } from '@/api/accounts'
import { toISODate } from '@/accounts/detail/utils/date'

// Round a date down to the start of the bucket it falls in. Day buckets have
// no rounding; week buckets snap to Monday (ISO); month/quarter snap to the
// 1st of the bucket's calendar period.
function bucketStart(d: Date, granularity: SnapshotGranularity): Date {
  if (granularity === 'day') {
    const c = new Date(d)
    c.setHours(0, 0, 0, 0)
    return c
  }
  if (granularity === 'week') {
    const c = new Date(d)
    c.setHours(0, 0, 0, 0)
    const day = c.getDay() // 0=Sunday
    const toMonday = day === 0 ? -6 : 1 - day
    c.setDate(c.getDate() + toMonday)
    return c
  }
  if (granularity === 'month') {
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }
  // quarter
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
}

// Advance `d` to the start of the next bucket.
function advanceBucket(d: Date, granularity: SnapshotGranularity): Date {
  const c = new Date(d)
  if (granularity === 'day') c.setDate(c.getDate() + 1)
  else if (granularity === 'week') c.setDate(c.getDate() + 7)
  else if (granularity === 'month') c.setMonth(c.getMonth() + 1)
  else c.setMonth(c.getMonth() + 3)
  return c
}

// Generate per-bucket samples. Each bucket contributes one chart point: the
// X-axis position sits at the bucket's START (e.g., Jan 1 for January), while
// the balance is read at the bucket's END (Jan 31). For the current bucket
// (not yet closed), end is clipped to today so the latest data reflects.
function generateBuckets(
  fromDate: Date,
  today: Date,
  granularity: SnapshotGranularity,
): { labelDate: Date; valueDate: Date }[] {
  const buckets: { labelDate: Date; valueDate: Date }[] = []
  let cursor = bucketStart(fromDate, granularity)
  while (cursor <= today) {
    const nextStart = advanceBucket(cursor, granularity)
    const bucketEnd = new Date(nextStart)
    bucketEnd.setDate(bucketEnd.getDate() - 1) // inclusive last day of bucket
    const valueDate = bucketEnd > today ? today : bucketEnd
    buckets.push({ labelDate: new Date(cursor), valueDate })
    cursor = nextStart
  }
  return buckets
}

// Build the chart series: one point per bucket. Balance comes from the latest
// snapshot at or before the bucket's end. Buckets with no preceding data
// render at 0. Each point also carries a `tooltipLabel` that names the exact
// date the balance is read at (e.g. "Jan 31, 2026") — useful because the
// axis label sits at the bucket start ("Jan") which would otherwise be
// ambiguous on hover.
export function buildChartSeries(
  snapshots: AccountBalanceSnapshot[],
  fromDate: Date,
  granularity: SnapshotGranularity,
): { date: string; dateLabel: string; tooltipLabel: string; balance: number }[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const buckets = generateBuckets(fromDate, today, granularity)
  if (buckets.length === 0) return []

  const sorted = [...snapshots].sort((a, b) => a.dt.localeCompare(b.dt))

  // Pointer walks through sorted snapshots as bucket-end dates advance.
  // Buckets before the first snapshot render at 0 (no data yet).
  let idx = 0
  let runningBalance = 0
  const points: { date: string; dateLabel: string; tooltipLabel: string; balance: number }[] = []
  for (const bucket of buckets) {
    const valueDateStr = toISODate(bucket.valueDate)
    while (idx < sorted.length && sorted[idx].dt <= valueDateStr) {
      runningBalance = sorted[idx].balance
      idx++
    }
    points.push({
      date: toISODate(bucket.labelDate),
      dateLabel: bucket.labelDate.toLocaleDateString('en-US', {
        month: 'short',
        day: granularity === 'month' ? undefined : 'numeric',
      }),
      tooltipLabel: bucket.valueDate.toLocaleDateString('en-US', {
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
  series: { date: string; dateLabel: string; tooltipLabel: string; balance: number }[],
): { date: string; dateLabel: string; tooltipLabel: string; balance: number; periodBalance: number }[] {
  if (series.length === 0) return []
  const baseline = series[0].balance
  return series.map((point) => ({
    ...point,
    periodBalance: point.balance - baseline,
  }))
}

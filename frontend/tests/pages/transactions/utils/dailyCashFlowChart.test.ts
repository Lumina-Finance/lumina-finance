/**
 * Tests daily cash-flow chart calculations so date bucketing, labels, and tick selection stay stable as the chart rendering is refactored
 */
import { describe, expect, it } from 'vitest'
import type { DailyCashFlow } from '@/api/transactions'
import {
  getDailyCashFlowCalculation,
  getDailyCashFlowGranularity,
  getDailyCashFlowSeries,
  getDailyCashFlowXAxisTickCount,
  getDailyCashFlowXAxisTicks,
  type DailyCashFlowPoint,
} from '@/pages/transactions/utils/dailyCashFlowChart'

describe('daily cash-flow chart helpers', () => {
  it('keeps a bucket dated with a day the calendar does not have, labelled with its raw bounds', () => {
    const series = getDailyCashFlowSeries(
      [{ date: '2026-02-31', end_date: '2026-03-06', inflow: 10000, outflow: -2500 }],
      'week',
      false,
    )

    expect(series).toHaveLength(1)
    expect(series[0].date).toBe('2026-02-31')
    expect(series[0].rangeLabel).toBe('2026-02-31 – Mar 6, 2026')
    expect(series[0].net).toBe(7500)
  })

  it('selects day, week, and month granularity from the selected date span', () => {
    expect(getDailyCashFlowGranularity('2026-01-01', '2026-01-31')).toBe('day')
    expect(getDailyCashFlowGranularity('2026-01-01', '2026-02-01')).toBe('week')
    expect(getDailyCashFlowGranularity('2026-01-01', '2026-07-03')).toBe('month')
    expect(getDailyCashFlowGranularity('2026-02-01', '2026-01-01')).toBe('day')
  })

  it('builds chart points with net totals and full bucket labels', () => {
    expect(
      getDailyCashFlowSeries(
        [
          {
            date: '2026-01-01',
            end_date: '2026-01-07',
            inflow: 10000,
            outflow: -2500,
          },
        ],
        'week',
        false,
      ),
    ).toEqual([
      {
        key: '2026-01-01',
        date: 'Jan 1',
        marksYear: false,
        rangeLabel: 'Jan 1 – 7, 2026',
        inflow: 10000,
        outflow: -2500,
        net: 7500,
      },
    ])
  })

  it('keeps calculation text aligned with chart mode and bucket cadence', () => {
    expect(getDailyCashFlowCalculation('day', 'net')).toBe(
      "Each day's money in minus money out. Transfers count except Balance Adjustment.",
    )
    expect(getDailyCashFlowCalculation('month', 'gross')).toBe(
      "Each month's money in and money out. Transfers count except Balance Adjustment.",
    )
  })

  it('limits X-axis ticks by available width while preserving first and last buckets', () => {
    const points: DailyCashFlowPoint[] = Array.from({ length: 12 }, (_, index) => ({
      key: `point-${index + 1}`,
      date: `Point ${index + 1}`,
      marksYear: false,
      rangeLabel: `Point ${index + 1}`,
      inflow: 0,
      outflow: 0,
      net: 0,
    }))

    expect(getDailyCashFlowXAxisTickCount(undefined)).toBe(10)
    expect(getDailyCashFlowXAxisTickCount(180)).toBe(2)
    expect(getDailyCashFlowXAxisTicks(points, 4, 400)).toEqual(['point-1', 'point-5', 'point-9', 'point-12'])
  })
})

/**
 * Builds the API's monthly buckets, one per month from the given one, each running from its first day to its last
 */
function monthlyBuckets(firstYear: number, firstMonth: number, count: number): DailyCashFlow[] {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(firstYear, firstMonth - 1 + index, 1)).toISOString().slice(0, 10),
    end_date: new Date(Date.UTC(firstYear, firstMonth + index, 0)).toISOString().slice(0, 10),
    inflow: 1000,
    outflow: -400,
  }))
}

describe('daily cash-flow chart year labels', () => {
  it('names the year on the January label alone when a monthly range crosses a year', () => {
    const series = getDailyCashFlowSeries(monthlyBuckets(2025, 10, 13), 'month', true)

    expect(series.map((point) => point.date)).toEqual([
      'Oct',
      'Nov',
      'Dec',
      'Jan 2026',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
    ])
    expect(series.filter((point) => point.marksYear).map((point) => point.key)).toEqual(['2026-01-01'])
  })

  it('names the year on every January of a range over two years', () => {
    const series = getDailyCashFlowSeries(monthlyBuckets(2025, 1, 24), 'month', true)

    expect(series.filter((point) => point.marksYear).map((point) => point.date)).toEqual(['Jan 2025', 'Jan 2026'])
  })

  it('keeps the full dates in every tooltip', () => {
    const series = getDailyCashFlowSeries(monthlyBuckets(2025, 10, 13), 'month', true)

    expect(series[3].rangeLabel).toBe('Jan 1 – 31, 2026')
    expect(series[0].rangeLabel).toBe('Oct 1 – 31, 2025')
  })

  it('leaves a monthly range inside one year without a year', () => {
    const series = getDailyCashFlowSeries(monthlyBuckets(2026, 3, 8), 'month', false)

    expect(series.map((point) => point.date)).toEqual(['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'])
    expect(series.some((point) => point.marksYear)).toBe(false)
  })

  it('leaves weekly buckets over a year change labelled by their day, with no year', () => {
    const series = getDailyCashFlowSeries(
      [
        { date: '2025-12-29', end_date: '2026-01-04', inflow: 1000, outflow: -400 },
        { date: '2026-01-05', end_date: '2026-01-11', inflow: 1000, outflow: -400 },
      ],
      'week',
      true,
    )

    expect(series.map((point) => point.date)).toEqual(['Dec 29', 'Jan 5'])
    expect(series.some((point) => point.marksYear)).toBe(false)
  })

  // The ticks always kept the first and last buckets, which left the two Octobers with no January between them
  it('puts a tick on the January that names the year, with the rest evenly stepped from it', () => {
    const series = getDailyCashFlowSeries(monthlyBuckets(2025, 10, 13), 'month', true)

    const ticks = getDailyCashFlowXAxisTicks(series, 10, 280)

    expect(ticks).toContain('2026-01-01')
    expect(ticks).toEqual(['2025-10-01', '2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'])
  })

  it('keeps the first and last buckets when no bucket names the year', () => {
    const series = getDailyCashFlowSeries(monthlyBuckets(2026, 3, 8), 'month', false)

    expect(getDailyCashFlowXAxisTicks(series, 10, 280)).toEqual(getDailyCashFlowXAxisTicks(series, 10, 0))
    expect(getDailyCashFlowXAxisTicks(series, 10, 280)).toContain('2026-03-01')
    expect(getDailyCashFlowXAxisTicks(series, 10, 280)).toContain('2026-10-01')
  })
})

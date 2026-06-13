/**
 * Tests daily cash-flow chart calculations so date bucketing, labels, and tick selection stay stable as the chart rendering is refactored
 */
import { describe, expect, it } from 'vitest'
import {
  getDailyCashFlowCalculation,
  getDailyCashFlowGranularity,
  getDailyCashFlowSeries,
  getDailyCashFlowXAxisTickCount,
  getDailyCashFlowXAxisTicks,
  type DailyCashFlowPoint,
} from '@/transactions/utils/dailyCashFlowChart'

describe('daily cash-flow chart helpers', () => {
  it('selects day, week, and month granularity from the selected date span', () => {
    expect(getDailyCashFlowGranularity('2026-01-01', '2026-01-31')).toBe('day')
    expect(getDailyCashFlowGranularity('2026-01-01', '2026-02-01')).toBe('week')
    expect(getDailyCashFlowGranularity('2026-01-01', '2026-07-03')).toBe('month')
    expect(getDailyCashFlowGranularity('2026-02-01', '2026-01-01')).toBe('day')
  })

  it('builds chart points with net totals and full bucket labels', () => {
    expect(getDailyCashFlowSeries([
      {
        date: '2026-01-01',
        end_date: '2026-01-07',
        inflow: 10000,
        outflow: -2500,
      },
    ], 'week')).toEqual([
      {
        key: '2026-01-01',
        date: 'Jan 1',
        rangeLabel: 'Jan 1, 2026 - Jan 7, 2026',
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
      rangeLabel: `Point ${index + 1}`,
      inflow: 0,
      outflow: 0,
      net: 0,
    }))

    expect(getDailyCashFlowXAxisTickCount(undefined)).toBe(10)
    expect(getDailyCashFlowXAxisTickCount(180)).toBe(2)
    expect(getDailyCashFlowXAxisTicks(points, 4)).toEqual([
      'point-1',
      'point-5',
      'point-9',
      'point-12',
    ])
  })
})

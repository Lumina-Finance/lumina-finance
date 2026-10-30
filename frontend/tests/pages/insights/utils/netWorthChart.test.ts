/**
 * Covers how the net worth chart turns each point's date into the position it is plotted at, which
 * is the one reader with no label to fall back to when the date is not a real one, and how its
 * starting label writes the first net worth, which rounds down so it never sits above the value
 */
import { describe, expect, it } from 'vitest'
import {
  formatNetWorthStartLabel,
  getNetWorthChartData,
  getNetWorthChartItems,
  type NetWorthPoint,
} from '@/pages/insights/utils/netWorthChart'

const GROUPS = [{ id: 'cash', name: 'Cash', kind: 'asset' as const }]

/**
 * Builds a one-group series point carrying the supplied date
 */
function createPoint(date: string): NetWorthPoint {
  return { date, dateLabel: date, tooltipLabel: date, total: 100, values: [100] }
}

describe('net worth chart positions', () => {
  it('plots a point at the UTC midnight of its calendar day', () => {
    const items = getNetWorthChartItems(GROUPS, 'overview')

    const [point] = getNetWorthChartData([createPoint('2026-03-09')], items, 'overview')

    expect(point.dateMs).toBe(Date.UTC(2026, 2, 9))
  })

  it('refuses a date the calendar does not have rather than plotting it in the next month', () => {
    const items = getNetWorthChartItems(GROUPS, 'overview')

    expect(() => getNetWorthChartData([createPoint('2026-02-31')], items, 'overview')).toThrow('2026-02-31')
  })

  it('refuses a date the browser would parse for itself', () => {
    const items = getNetWorthChartItems(GROUPS, 'overview')

    expect(() => getNetWorthChartData([createPoint('March 9, 2026')], items, 'overview')).toThrow()
  })
})

describe('net worth start label', () => {
  const currencies = [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }]

  // The label above the first bar is a net worth figure, so it rounds down and never reads above the
  // first value. 2,960.00 is 3.0K to the nearest and 2.9K rounded down
  it('rounds down and keeps one decimal in K and M', () => {
    expect(formatNetWorthStartLabel(296_000, 'CAD', currencies)).toBe('CA$2.9K')
    expect(formatNetWorthStartLabel(100_000, 'CAD', currencies)).toBe('CA$1.0K')
    expect(formatNetWorthStartLabel(99_999_999, 'CAD', currencies)).toBe('CA$999.9K')
    expect(formatNetWorthStartLabel(100_000_000, 'CAD', currencies)).toBe('CA$1.0M')
    expect(formatNetWorthStartLabel(125_000_000, 'CAD', currencies)).toBe('CA$1.2M')
    expect(formatNetWorthStartLabel(0, 'CAD', currencies)).toBe('CA$0')
  })

  it('reads below 1K for 999.99, and rounds a negative net worth down, away from zero', () => {
    expect(formatNetWorthStartLabel(99_999, 'CAD', currencies)).toBe('CA$999')
    expect(formatNetWorthStartLabel(-296_000, 'CAD', currencies)).toBe('(CA$3.0K)')
  })
})

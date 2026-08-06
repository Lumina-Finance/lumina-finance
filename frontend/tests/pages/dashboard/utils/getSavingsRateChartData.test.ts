/**
 * Tests the savings rate chart data, so the current period is still plotted while it is empty and an
 * expense month with no income reads as an unbounded loss rather than a number
 */
import { describe, expect, it } from 'vitest'
import type { SavingsRateSeriesPoint } from '@/pages/dashboard/types/dashboard'
import {
  getSavingsRateChartData,
  getSavingsRateDisplay,
} from '@/pages/dashboard/utils/getSavingsRateChartData'

describe('savings rate chart data', () => {
  it('builds savings rate chart data without hiding the current empty period', () => {
    const points: SavingsRateSeriesPoint[] = [
      {
        monthLabel: 'Jan',
        fullLabel: 'January 2026',
        rate: null,
        income: 0,
        expenses: 0,
        isCurrent: false,
      },
      {
        monthLabel: 'Feb',
        fullLabel: 'February 2026',
        rate: 125,
        income: 10000,
        expenses: -2500,
        isCurrent: false,
      },
      {
        monthLabel: 'Mar',
        fullLabel: 'March 2026',
        rate: null,
        income: 0,
        expenses: 0,
        isCurrent: true,
      },
    ]

    expect(getSavingsRateChartData(points, true)).toEqual([
      { ...points[1], chartRate: 100 },
      { ...points[2], chartRate: null },
    ])
    expect(getSavingsRateDisplay({
      ...points[0],
      income: 0,
      expenses: 500,
      chartRate: -100,
    })).toBe('−∞%')
  })
})

/**
 * Tests the savings rate chart data, so the current period is still plotted while it is empty and an
 * expense month with no income reads N/A rather than a number
 */
import { describe, expect, it } from 'vitest'
import type { SavingsRateSeriesPoint } from '@/components/charts/types'
import { getSavingsRateChartData, getSavingsRateDisplay } from '@/pages/dashboard/utils/getSavingsRateChartData'

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
    expect(
      getSavingsRateDisplay({
        ...points[0],
        income: 0,
        expenses: 500,
        chartRate: -100,
      }),
    ).toBe('N/A')
  })

  it('rounds the tooltip rate down, so an exact 14.5% reads 14% and -14.5% reads -15%', () => {
    const point: SavingsRateSeriesPoint & { chartRate: number | null } = {
      monthLabel: 'Mar',
      fullLabel: 'March 2026',
      rate: 14,
      income: 200_000,
      expenses: 171_000,
      isCurrent: false,
      chartRate: 14,
    }

    expect(getSavingsRateDisplay(point)).toBe('14%')
    expect(getSavingsRateDisplay({ ...point, expenses: 229_000 })).toBe('−15%')
  })
})

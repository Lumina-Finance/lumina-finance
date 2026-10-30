/**
 * Covers the net worth card labelling its points by the bucket size the backend grouped them into,
 * which once labelled a 91 to 183 day range of weekly points by month, and naming the year on the
 * January label when a monthly range crosses a calendar year so no month repeats unplaced
 */
import { describe, expect, it } from 'vitest'
import { getNetWorthCardData } from '@/pages/insights/utils/netWorth'

/**
 * Builds the response's monthly points, one per month from the given one, each dated by its first day
 * and valued at its last
 */
function monthlyPoints(firstYear: number, firstMonth: number, count: number): [string, string, number[]][] {
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(Date.UTC(firstYear, firstMonth - 1 + index, 1))
    const end = new Date(Date.UTC(firstYear, firstMonth + index, 0))
    return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), [100]]
  })
}

function monthlySeries(firstYear: number, firstMonth: number, count: number, fromDate: string, toDate: string) {
  return getNetWorthCardData(
    {
      groups: [['cash', 'Cash', 'asset']],
      baseline: [0],
      points: monthlyPoints(firstYear, firstMonth, count),
      fx_status: { state: 'none', missing_pairs: [] },
    },
    fromDate,
    toDate,
  ).series
}

describe('getNetWorthCardData', () => {
  it('labels the points of a 92-day range by their day', () => {
    const { series } = getNetWorthCardData(
      {
        groups: [['cash', 'Cash', 'asset']],
        baseline: [0],
        points: [['2026-01-05', '2026-01-11', [100]]],
        fx_status: { state: 'none', missing_pairs: [] },
      },
      '2026-01-05',
      '2026-04-06',
    )

    expect(series[0].dateLabel).toBe('Jan 5')
  })

  describe('a monthly range', () => {
    const bareMonths = ['Oct', 'Nov', 'Dec', 'Jan 2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']

    it('names the year on the January label alone when the range crosses a year', () => {
      const series = monthlySeries(2025, 10, 13, '2025-10-01', '2026-10-27')

      expect(series.map((point) => point.dateLabel)).toEqual(bareMonths)
      expect(series.map((point) => point.marksYear)).toEqual(bareMonths.map((label) => label === 'Jan 2026'))
    })

    it('names the year on every January of a range over two years', () => {
      const series = monthlySeries(2025, 1, 24, '2025-01-01', '2026-12-31')

      expect(series.filter((point) => point.marksYear).map((point) => point.dateLabel)).toEqual([
        'Jan 2025',
        'Jan 2026',
      ])
      expect(series.filter((point) => !point.marksYear).every((point) => /^[A-Z][a-z]{2}$/.test(point.dateLabel))).toBe(
        true,
      )
    })

    it('marks the January of a twelve month range that starts mid-year', () => {
      const series = monthlySeries(2025, 6, 12, '2025-06-01', '2026-05-31')

      expect(series.filter((point) => point.marksYear).map((point) => point.dateLabel)).toEqual(['Jan 2026'])
    })

    it('leaves a range inside one calendar year without a year', () => {
      const series = monthlySeries(2026, 3, 8, '2026-03-01', '2026-10-27')

      expect(series.map((point) => point.dateLabel)).toEqual(['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'])
      expect(series.some((point) => point.marksYear)).toBe(false)

      const thisYear = monthlySeries(2026, 1, 10, '2026-01-01', '2026-10-27')
      expect(thisYear[0].dateLabel).toBe('Jan')
      expect(thisYear.some((point) => point.marksYear)).toBe(false)
    })

    it('keeps the full date in every tooltip', () => {
      const series = monthlySeries(2025, 10, 13, '2025-10-01', '2026-10-27')

      expect(series[3].tooltipLabel).toBe('Jan 31, 2026')
      expect(series[0].tooltipLabel).toBe('Oct 31, 2025')
    })
  })

  it('leaves weekly points over a year change labelled by their day, with no year', () => {
    const { series } = getNetWorthCardData(
      {
        groups: [['cash', 'Cash', 'asset']],
        baseline: [0],
        points: [
          ['2025-12-29', '2026-01-04', [100]],
          ['2026-01-05', '2026-01-11', [100]],
        ],
        fx_status: { state: 'none', missing_pairs: [] },
      },
      '2025-12-15',
      '2026-03-01',
    )

    expect(series.map((point) => point.dateLabel)).toEqual(['Dec 29', 'Jan 5'])
    expect(series.some((point) => point.marksYear)).toBe(false)
  })
})

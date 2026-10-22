/**
 * Tests the savings rate series, so a month dated with a day the calendar does not have keeps its own
 * label rather than being moved to a real one
 */
import { describe, expect, it } from 'vitest'
import { getSavingsRateSeries } from '@/pages/dashboard/utils/getSavingsRateSeries'
import { fxStatus } from './fixtures'

describe('savings rate series', () => {
  it('keeps a savings-rate month the calendar does not have as its own label', () => {
    const [point] = getSavingsRateSeries({
      savings_rate_history: [{ month: '2026-02-31', income: 100, expenses: 50 }],
      fx_status: fxStatus,
    })

    expect(point.monthLabel).toBe('2026-02-31')
    expect(point.fullLabel).toBe('2026-02-31')
    expect(point.rate).toBe(50)
  })

  it('rounds a month\'s rate down, so an exact 14.5% reads 14% and -14.5% reads -15%', () => {
    const rates = getSavingsRateSeries({
      savings_rate_history: [
        { month: '2026-03-01', income: 200_000, expenses: 171_000 },
        { month: '2026-04-01', income: 200_000, expenses: 229_000 },
        { month: '2026-05-01', income: 10_000, expenses: 8_501 },
      ],
      fx_status: fxStatus,
    }).map((point) => point.rate)

    expect(rates).toEqual([14, -15, 14])
  })
})

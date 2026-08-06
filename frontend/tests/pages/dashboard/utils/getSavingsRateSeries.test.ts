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
})

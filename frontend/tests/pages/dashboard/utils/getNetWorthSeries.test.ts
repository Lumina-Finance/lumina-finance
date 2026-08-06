/**
 * Tests the net worth series, so the history is labelled backwards from today rather than from a
 * fixed start, and the last point is the current day
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NetWorthWidgetResponse } from '@/api/dashboard'
import { getNetWorthSeries } from '@/pages/dashboard/utils/getNetWorthSeries'
import { fxStatus } from './fixtures'

afterEach(() => {
  vi.useRealTimers()
})

describe('net worth series', () => {
  it('labels net worth history from the current trailing date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'))

    const netWorth: NetWorthWidgetResponse = {
      current_net_worth: 300000,
      net_worth_history: [100000, 200000, 300000],
      net_worth_window_days: 3,
      fx_status: fxStatus,
    }

    expect(getNetWorthSeries(netWorth)).toEqual([
      { date: 'Jan 3', value: 100000 },
      { date: 'Jan 4', value: 200000 },
      { date: 'Jan 5', value: 300000 },
    ])
  })
})

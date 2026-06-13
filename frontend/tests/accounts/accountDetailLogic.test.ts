/**
 * Tests account detail helper behaviour so balance chart range, delta, and snapshot rules stay stable while the chart JSX is split apart
 */
import { describe, expect, it } from 'vitest'
import type { AccountBalanceSnapshot } from '@/api/accounts'
import { calendarDateMs } from '@/accounts/detail/utils/balanceChartAxis'
import {
  getBalanceChartSnapshot,
  getBalancePeriodDelta,
  getBalanceRangeWindow,
  getBalanceYearBoundary,
} from '@/accounts/detail/utils/balanceChartViewModel'
import { toISODate } from '@/accounts/detail/utils/date'

describe('balance chart view model helpers', () => {
  it('derives the selected range window from a local-day anchor date', () => {
    const window = getBalanceRangeWindow('30D', new Date(2026, 5, 13, 14, 30))

    expect(toISODate(window.fromDate)).toBe('2026-05-15')
    expect(toISODate(window.toDate)).toBe('2026-06-13')
    expect(window.granularity).toBe('day')
  })

  it('calculates absolute and percentage movement from the first and last chart points', () => {
    expect(getBalancePeriodDelta([
      {
        date: '2026-06-01',
        dateMs: calendarDateMs(new Date(2026, 5, 1)),
        dateLabel: 'Jun 1',
        tooltipLabel: 'Jun 1, 2026',
        balance: 10_000,
      },
      {
        date: '2026-06-02',
        dateMs: calendarDateMs(new Date(2026, 5, 2)),
        dateLabel: 'Jun 2',
        tooltipLabel: 'Jun 2, 2026',
        balance: 12_500,
      },
    ])).toEqual({
      absolute: 2_500,
      pct: 25,
    })
  })

  it('returns null percentage when the balance window starts at zero', () => {
    expect(getBalancePeriodDelta([
      {
        date: '2026-06-01',
        dateMs: calendarDateMs(new Date(2026, 5, 1)),
        dateLabel: 'Jun 1',
        tooltipLabel: 'Jun 1, 2026',
        balance: 0,
      },
      {
        date: '2026-06-02',
        dateMs: calendarDateMs(new Date(2026, 5, 2)),
        dateLabel: 'Jun 2',
        tooltipLabel: 'Jun 2, 2026',
        balance: 12_500,
      },
    ])).toEqual({
      absolute: 12_500,
      pct: null,
    })
  })

  it('finds a year boundary only when the selected range crosses New Year', () => {
    expect(getBalanceYearBoundary(new Date(2025, 11, 20), new Date(2026, 0, 10))).toEqual({
      dateMs: calendarDateMs(new Date(2026, 0, 1)),
      year: '2026',
    })
    expect(getBalanceYearBoundary(new Date(2026, 0, 1), new Date(2026, 0, 10))).toBeNull()
  })

  it('builds a change-mode chart snapshot from raw balance snapshots', () => {
    const snapshots: AccountBalanceSnapshot[] = [
      { account_id: 'account', dt: '2026-06-01', balance: 10_000 },
      { account_id: 'account', dt: '2026-06-03', balance: 11_500 },
    ]
    const snapshot = getBalanceChartSnapshot({
      snapshots,
      range: '7D',
      chartMode: 'change',
      currentBalance: 11_500,
      currency: 'USD',
      fromDate: new Date(2026, 5, 1),
      toDate: new Date(2026, 5, 3),
      granularity: 'day',
    })

    expect(snapshot.chartDataKey).toBe('periodBalance')
    expect(snapshot.chartSeries.map((point) => point.periodBalance)).toEqual([0, 0, 1_500])
    expect(snapshot.periodDelta).toEqual({ absolute: 1_500, pct: 15 })
    expect(snapshot.trendUp).toBe(true)
    expect(snapshot.chartLineColor).toBe('var(--app-positive)')
  })
})

/**
 * Tests the account balance chart view model so its range window, movement figures, year boundary and
 * change-mode series cannot drift from the snapshots they are built from
 */
import { describe, expect, it } from 'vitest'
import type { AccountBalanceSnapshot } from '@/api/accounts'
import { calendarDateMs } from '@/pages/accounts/detail/utils/calendarDate'
import {
  getBalanceChartSnapshot,
  getBalancePeriodDelta,
  getBalanceRangeWindow,
  getBalanceYearBoundary,
} from '@/pages/accounts/detail/utils/balanceChartViewModel'
import { formatYmd } from '@/utils/date'

describe('balance chart view model helpers', () => {
  it('ends the selected range window on the profile timezone day rather than the browser calendar', () => {
    // Late evening in Toronto on 30 June, already 1 July in UTC, so a zone mix-up shows up as a
    // different day and a different month
    const lateJuneEvening = new Date('2026-07-01T02:00:00Z')
    const window = getBalanceRangeWindow('30D', 'America/Toronto', lateJuneEvening)

    expect(formatYmd(window.fromDate)).toBe('2026-06-01')
    expect(formatYmd(window.toDate)).toBe('2026-06-30')
    expect(window.granularity).toBe('day')

    expect(formatYmd(getBalanceRangeWindow('30D', 'UTC', lateJuneEvening).toDate)).toBe('2026-07-01')
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

    // The same rise is a figure and a line, so it carries the text green and the chart green at once
    expect(snapshot.deltaColor).toBe('var(--app-positive)')
    expect(snapshot.chartLineColor).toBe('var(--app-chart-positive)')
  })

  it('keeps the gold line in balance mode and moves only its red', () => {
    const snapshots: AccountBalanceSnapshot[] = [
      { account_id: 'account', dt: '2026-06-01', balance: 10_000 },
      { account_id: 'account', dt: '2026-06-03', balance: 11_500 },
    ]
    const buildBalanceMode = (currentBalance: number) => getBalanceChartSnapshot({
      snapshots,
      range: '7D',
      chartMode: 'balance',
      currentBalance,
      currency: 'USD',
      fromDate: new Date(2026, 5, 1),
      toDate: new Date(2026, 5, 3),
      granularity: 'day',
    })

    expect(buildBalanceMode(11_500).chartLineColor).toBe('var(--app-accent)')
    expect(buildBalanceMode(-500).chartLineColor).toBe('var(--app-chart-negative)')
  })

  it('splits a falling period the same way, and colours a period with no movement at all grey', () => {
    const falling = getBalanceChartSnapshot({
      snapshots: [
        { account_id: 'account', dt: '2026-06-01', balance: 11_500 },
        { account_id: 'account', dt: '2026-06-03', balance: 10_000 },
      ],
      range: '7D',
      chartMode: 'change',
      currentBalance: 10_000,
      currency: 'USD',
      fromDate: new Date(2026, 5, 1),
      toDate: new Date(2026, 5, 3),
      granularity: 'day',
    })

    expect(falling.trendUp).toBe(false)
    expect(falling.deltaColor).toBe('var(--app-negative)')
    expect(falling.chartLineColor).toBe('var(--app-chart-negative)')

    // One day of range leaves a single point, so there is no movement to measure between two
    const singleDay = getBalanceChartSnapshot({
      snapshots: [{ account_id: 'account', dt: '2026-06-01', balance: 10_000 }],
      range: '7D',
      chartMode: 'change',
      currentBalance: 10_000,
      currency: 'USD',
      fromDate: new Date(2026, 5, 1),
      toDate: new Date(2026, 5, 1),
      granularity: 'day',
    })

    expect(singleDay.periodDelta).toBeNull()
    expect(singleDay.deltaColor).toBe('var(--app-text-muted)')
    expect(singleDay.chartLineColor).toBe('var(--app-accent)')
  })
})

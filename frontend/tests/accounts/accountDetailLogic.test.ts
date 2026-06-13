/**
 * Tests account detail helper behaviour so balance chart range, delta, and snapshot rules stay stable while the chart JSX is split apart
 */
import { describe, expect, it } from 'vitest'
import type {
  AccountBalanceSnapshot,
  AccountMonthlyCashFlow,
  AccountSpendingBreakdown,
} from '@/api/accounts'
import { calendarDateMs } from '@/accounts/detail/utils/balanceChartAxis'
import {
  getBalanceChartSnapshot,
  getBalancePeriodDelta,
  getBalanceRangeWindow,
  getBalanceYearBoundary,
} from '@/accounts/detail/utils/balanceChartViewModel'
import {
  getCashFlowDomainMax,
  getCompletedCashFlowAverage,
  getMonthlyCashFlowBars,
} from '@/accounts/detail/utils/cashFlowChartViewModel'
import {
  appendOtherBreakdownRow,
  getBreakdownRowFillPercent,
  getBreakdownRows,
} from '@/accounts/detail/utils/spendingBreakdownViewModel'
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

describe('monthly cash flow view model helpers', () => {
  const rows: AccountMonthlyCashFlow[] = [
    { month: '2026-04-01', income: 1_000, expenses: 600 },
    { month: '2026-05-01', income: 2_000, expenses: 900 },
    { month: '2026-06-01', income: 500, expenses: 200 },
  ]

  it('projects monthly cash flow rows into chart labels and values', () => {
    expect(getMonthlyCashFlowBars(rows)).toEqual([
      { label: 'Apr', tooltipLabel: 'Apr 2026', income: 1_000, expense: 600 },
      { label: 'May', tooltipLabel: 'May 2026', income: 2_000, expense: 900 },
      { label: 'Jun', tooltipLabel: 'Jun 2026', income: 500, expense: 200 },
    ])
  })

  it('excludes the current partial month from the average bar', () => {
    expect(getCompletedCashFlowAverage(rows)).toEqual({
      avgIn: 1_500,
      avgOut: 750,
    })
  })

  it('keeps chart domain above zero and shared across monthly and average bars', () => {
    expect(getCashFlowDomainMax([], { avgIn: 0, avgOut: 0 })).toBe(1)
    expect(getCashFlowDomainMax(getMonthlyCashFlowBars(rows), { avgIn: 1_500, avgOut: 2_500 })).toBe(2_500)
  })
})

describe('spending breakdown view model helpers', () => {
  it('adds an Other row using the remaining grand total', () => {
    expect(appendOtherBreakdownRow([
      { key: 'groceries', name: 'Groceries', total: 6_000, isOther: false },
      { key: 'travel', name: 'Travel', total: 3_000, isOther: false },
    ], 3, 10_000)).toEqual([
      { key: 'groceries', name: 'Groceries', total: 6_000, isOther: false },
      { key: 'travel', name: 'Travel', total: 3_000, isOther: false },
      { key: 'other', name: 'Other (3)', total: 1_000, isOther: true },
    ])
  })

  it('keeps tiny non-zero breakdown rows visible and handles signed totals', () => {
    expect(getBreakdownRowFillPercent(10, 10_000)).toBe(4)
    expect(getBreakdownRowFillPercent(-2_500, -10_000)).toBe(25)
    expect(getBreakdownRowFillPercent(0, 0)).toBe(0)
  })

  it('projects backend spending breakdown payloads into visible rows', () => {
    const payload: AccountSpendingBreakdown = {
      range: 'MTD',
      top_categories: [
        { category_id: 'food', name: 'Food', total: 7_000 },
      ],
      top_merchants: [],
      grand_total_spend: 10_000,
      other_categories_count: 2,
      other_merchants_count: 0,
    }

    expect(getBreakdownRows(
      payload,
      (breakdown) => breakdown.top_categories.map((category) => ({
        key: category.category_id,
        name: category.name,
        total: category.total,
        isOther: false,
      })),
      (breakdown) => breakdown.other_categories_count,
    )).toEqual([
      { key: 'food', name: 'Food', total: 7_000, isOther: false },
      { key: 'other', name: 'Other (2)', total: 3_000, isOther: true },
    ])
  })
})

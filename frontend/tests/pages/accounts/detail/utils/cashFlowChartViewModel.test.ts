/**
 * Tests the account monthly cash flow view model so its bars, its average and its chart domain cannot
 * drift from the months the backend sends
 */
import { describe, expect, it } from 'vitest'
import type { AccountMonthlyCashFlow } from '@/api/accounts'
import {
  getCashFlowDomainMax,
  getCompletedCashFlowAverage,
  getMonthlyCashFlowBars,
} from '@/pages/accounts/detail/utils/cashFlowChartViewModel'

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

  it('keeps a month dated with a day the calendar does not have, labelled with its raw value', () => {
    expect(getMonthlyCashFlowBars([
      { month: '2026-02-31', income: 1_000, expenses: 600 },
    ])).toEqual([
      { label: '2026-02-31', tooltipLabel: '2026-02-31', income: 1_000, expense: 600 },
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

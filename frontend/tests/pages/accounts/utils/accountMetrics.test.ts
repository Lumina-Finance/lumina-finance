/**
 * Tests the account metrics themselves, so the savings rate, credit usage and runway figures cannot
 * drift from the history and balances they are calculated from
 *
 * A currency's symbol is written the reader's way, so the amounts below assume the region the suite
 * pins through LC_ALL in its package script: read from the United States, where US dollars are the
 * plain ones and Canadian dollars are marked CA$
 */
import { describe, expect, it } from 'vitest'
import type { RunwayResult } from '@/api/user'
import {
  getCreditUsageMetric,
  getRunwayMetric,
  getSavingsRateMetric,
} from '@/pages/accounts/utils/accountMetrics'
import { createAccount, testCurrencies } from './fixtures'

describe('account metric helpers', () => {
  it('uses the latest savings period and handles no-income expense months', () => {
    expect(getSavingsRateMetric({
      savings_rate_history: [
        { month: '2026-05-01', income: 1_000, expenses: 900 },
        { month: '2026-06-01', income: 2_000, expenses: 1_500 },
      ],
      fx_status: { state: 'complete', missing_pairs: [] },
    }, false)).toMatchObject({
      value: 25,
      hasExpenses: true,
      net: 500,
      income: 2_000,
      progress: 25,
      color: 'var(--app-positive)',
      barColor: 'var(--app-chart-positive)',
    })

    expect(getSavingsRateMetric({
      savings_rate_history: [
        { month: '2026-06-01', income: 0, expenses: 100 },
      ],
      fx_status: { state: 'none', missing_pairs: [] },
    }, false)).toMatchObject({
      value: null,
      hasExpenses: true,
      progress: 100,
      color: 'var(--app-negative)',
      barColor: 'var(--app-chart-negative)',
    })
  })

  it('places the savings rate tile in the same band as the savings rate charts', () => {
    const getTileColors = (income: number, expenses: number) => {
      const metric = getSavingsRateMetric({
        savings_rate_history: [{ month: '2026-06-01', income, expenses }],
        fx_status: { state: 'complete', missing_pairs: [] },
      }, false)

      return { value: metric.value, color: metric.color, barColor: metric.barColor }
    }

    expect(getTileColors(100, 80)).toEqual({
      value: 20,
      color: 'var(--app-positive)',
      barColor: 'var(--app-chart-positive)',
    })
    expect(getTileColors(100, 81)).toEqual({
      value: 19,
      color: 'var(--app-accent)',
      barColor: 'var(--app-accent)',
    })
    expect(getTileColors(100, 90)).toEqual({
      value: 10,
      color: 'var(--app-accent)',
      barColor: 'var(--app-accent)',
    })
    expect(getTileColors(100, 91)).toEqual({
      value: 9,
      color: 'var(--app-negative)',
      barColor: 'var(--app-chart-negative)',
    })
  })

  it('leaves an empty or still-loading savings rate tile grey rather than red', () => {
    expect(getSavingsRateMetric({
      savings_rate_history: [{ month: '2026-06-01', income: 0, expenses: 0 }],
      fx_status: { state: 'none', missing_pairs: [] },
    }, false)).toMatchObject({
      value: null,
      hasExpenses: false,
      color: 'var(--app-text-subtle)',
      barColor: 'var(--app-text-subtle)',
    })

    expect(getSavingsRateMetric({
      savings_rate_history: [{ month: '2026-06-01', income: 1_000, expenses: 100 }],
      fx_status: { state: 'complete', missing_pairs: [] },
    }, true)).toMatchObject({
      color: 'var(--app-text-subtle)',
      barColor: 'var(--app-text-subtle)',
    })
  })

  it('preserves credit empty states while using dashboard credit totals when available', () => {
    const rows = [
      createAccount({
        id: 'card',
        account_kind: 'revolving',
        account_type: 'credit_card',
        credit_limit: 1_000,
      }),
      createAccount({
        id: 'checking',
        account_kind: 'asset',
        account_type: 'checking',
      }),
    ]

    expect(getCreditUsageMetric(rows, {
      credit_used: 250,
      credit_limit_total: 1_000,
      fx_status: { state: 'complete', missing_pairs: [] },
    }, false)).toMatchObject({
      hasCreditAccounts: true,
      hasCreditLimits: true,
      hasCreditData: true,
      utilization: 25,
      totalUsed: 250,
      totalLimit: 1_000,
      color: 'var(--app-positive)',
      barColor: 'var(--app-chart-positive)',
    })
  })

  it('splits the credit usage figure from its bar across all three bands', () => {
    const rows = [createAccount({
      id: 'card',
      account_kind: 'revolving',
      account_type: 'credit_card',
      credit_limit: 1_000,
    })]
    const getTileColors = (creditUsed: number) => {
      const metric = getCreditUsageMetric(rows, {
        credit_used: creditUsed,
        credit_limit_total: 1_000,
        fx_status: { state: 'complete', missing_pairs: [] },
      }, false)

      return { utilization: metric.utilization, color: metric.color, barColor: metric.barColor }
    }

    expect(getTileColors(300)).toEqual({
      utilization: 30,
      color: 'var(--app-positive)',
      barColor: 'var(--app-chart-positive)',
    })
    expect(getTileColors(500)).toEqual({
      utilization: 50,
      color: 'var(--app-accent)',
      barColor: 'var(--app-accent)',
    })
    expect(getTileColors(800)).toEqual({
      utilization: 80,
      color: 'var(--app-negative)',
      barColor: 'var(--app-chart-negative)',
    })

    expect(getCreditUsageMetric(rows, undefined, false)).toMatchObject({
      color: 'var(--app-text-subtle)',
      barColor: 'var(--app-text-subtle)',
    })
  })

  it('formats runway captions for configuration gaps and usable runway data', () => {
    const runway: RunwayResult = {
      months: 7.4,
      reason: null,
      avg_monthly_expense: 123_456,
      months_covered: 6,
      liquid_balance: 900_000,
      account_balances: [],
      thresholds: {
        riskyBelowMonths: 3,
        healthyAtMonths: 6,
      },
      fx_status: { state: 'complete', missing_pairs: [] },
    }

    expect(getRunwayMetric(undefined, false, 'USD', testCurrencies)).toMatchObject({
      months: null,
      progress: 0,
      caption: '',
    })
    expect(getRunwayMetric({ ...runway, months: null, reason: 'no_accounts' }, false, 'USD', testCurrencies)).toMatchObject({
      caption: 'Choose accounts in Settings',
    })
    expect(getRunwayMetric(runway, false, 'USD', testCurrencies)).toMatchObject({
      months: 7.4,
      caption: '$1,234.56/mth · 6 mths basis',
      progress: 100,
    })
  })
})

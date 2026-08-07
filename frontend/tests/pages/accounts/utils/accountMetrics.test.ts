/**
 * Tests the account metrics themselves, so the savings rate, credit usage and runway figures cannot
 * drift from the history and balances they are calculated from
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
      caption: 'US$1,234.56/mth · 6 mths basis',
      progress: 100,
    })
  })
})

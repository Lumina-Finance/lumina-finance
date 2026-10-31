/**
 * Tests how account metrics are rendered for display, so the value and caption a user reads cannot
 * drift from the empty state or the FX gap behind them
 */
import { describe, expect, it } from 'vitest'
import type { AccountsMetricsViewModel } from '@/pages/accounts/types/accounts'
import { getCreditUsageDisplay, getSavingsRateDisplay } from '@/pages/accounts/utils/metricDisplay'
import { testCurrencies } from './fixtures'

describe('account metric display helpers', () => {
  it('formats savings rate empty states for accounts with expenses and no income', () => {
    const savingsRate: AccountsMetricsViewModel['savingsRate'] = {
      value: null,
      hasExpenses: true,
      isLoading: false,
      net: -5_000,
      income: 0,
      progress: 0,
      color: 'var(--app-negative)',
      barColor: 'var(--app-chart-negative)',
      fxStatus: undefined,
    }

    expect(getSavingsRateDisplay(savingsRate, 'USD', testCurrencies)).toEqual({
      value: 'N/A',
      caption: 'No income this month',
    })
  })

  it.each([
    [-5_000, '−$50.00'],
    [5_000, '+$50.00'],
  ])("signs the savings caption's net of %s as %s, like the period glance headline", (net, expected) => {
    const savingsRate: AccountsMetricsViewModel['savingsRate'] = {
      value: 10,
      hasExpenses: true,
      isLoading: false,
      net,
      income: 20_000,
      progress: 0,
      color: 'var(--app-text)',
      barColor: 'var(--app-text)',
      fxStatus: undefined,
    }

    expect(getSavingsRateDisplay(savingsRate, 'USD', testCurrencies).caption).toBe(`${expected} of $200.00 this month`)
  })

  it.each([
    [-20, '−20%'],
    [20, '20%'],
  ])('writes a savings rate of %s as %s, with a true minus when negative', (value, expected) => {
    const savingsRate: AccountsMetricsViewModel['savingsRate'] = {
      value,
      hasExpenses: true,
      isLoading: false,
      net: 0,
      income: 20_000,
      progress: 0,
      color: 'var(--app-text)',
      barColor: 'var(--app-text)',
      fxStatus: undefined,
    }

    expect(getSavingsRateDisplay(savingsRate, 'USD', testCurrencies).value).toBe(expected)
  })

  it('explains credit usage gaps caused by unavailable FX conversion', () => {
    const creditUsage: AccountsMetricsViewModel['creditUsage'] = {
      hasCreditAccounts: true,
      hasCreditLimits: true,
      hasCreditData: false,
      isLoading: false,
      utilization: 0,
      totalUsed: 0,
      totalLimit: 0,
      color: 'var(--app-text-subtle)',
      barColor: 'var(--app-text-subtle)',
      fxStatus: { state: 'unavailable', missing_pairs: [] },
    }

    expect(getCreditUsageDisplay(creditUsage, 'USD', testCurrencies)).toEqual({
      value: 'N/A',
      caption: 'FX unavailable',
    })
  })
})

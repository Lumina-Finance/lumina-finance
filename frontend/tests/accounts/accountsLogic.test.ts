/**
 * Tests account list helper behaviour so filtering, section totals, FX messages, and FX rollups cannot drift while the page components are split apart
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Institution } from '@/api/institutions'
import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import type { RunwayResult } from '@/api/user'
import type { AccountsMetricsViewModel } from '@/pages/accounts/types/accounts'
import {
  getActiveFilters,
  getFilteredRows,
  getInstitutionOptions,
  getKindOptions,
  getTypeOptions,
} from '@/pages/accounts/utils/filters'
import {
  getAccountSections,
  getCombinedAccountFxStatus,
} from '@/pages/accounts/utils/accountSections'
import {
  getCreditUsageMetric,
  getRunwayMetric,
  getSavingsRateMetric,
} from '@/pages/accounts/utils/accountMetrics'
import {
  getCreditUsageDisplay,
  getSavingsRateDisplay,
} from '@/pages/accounts/utils/metricDisplay'
import {
  formatTaxAdvantagedMeterMoney,
  getLifetimeAvailableBoundary,
  getTaxAdvantagedLimitSummaries,
  getTaxAdvantagedUsageColor,
  getTaxAdvantagedUsagePercent,
  hasTaxAdvantagedLimitTracking,
} from '@/pages/accounts/utils/taxAdvantagedLimits'
import {
  getAccountBalanceFxStatusMessage,
  getAccountSummaryFxStatusMessage,
} from '@/pages/accounts/utils/fxTooltipMessages'

function createAccount(overrides: Partial<AccountsOverview>): AccountsOverview {
  return {
    id: overrides.id ?? 'account',
    owner_id: null,
    group_id: null,
    account_kind: overrides.account_kind ?? 'asset',
    account_type: overrides.account_type ?? 'checking',
    tax_advantaged_category_id: null,
    name: overrides.name ?? 'Account',
    institution: overrides.institution ?? null,
    currency: overrides.currency ?? 'USD',
    current_balance: overrides.current_balance ?? 0,
    base_currency_current_balance: overrides.base_currency_current_balance ?? null,
    current_balance_fx_status: overrides.current_balance_fx_status ?? { state: 'none', missing_pairs: [] },
    credit_limit: overrides.credit_limit ?? null,
    is_archived: overrides.is_archived ?? false,
    closed_at: null,
    ...overrides,
  }
}

function createInstitution(id: string, name: string): Institution {
  return {
    id,
    status: 'active',
    name,
    country_code: 'US',
    website: `https://${id}.example.com`,
    logo_url: null,
  }
}

function createTaxAdvantagedCategory(overrides: Partial<TaxAdvantagedCategory>): TaxAdvantagedCategory {
  return {
    id: overrides.id ?? 'plan',
    category_owner_user_id: 'user',
    group_id: null,
    name: overrides.name ?? 'Plan',
    tax_treatment: 'tax_free',
    currency: overrides.currency ?? 'USD',
    lifetime_contribution_limit: null,
    accrued_contributions: 0,
    accrued_lifetime_contribution_limit: null,
    current_year_contribution_limit: null,
    current_year_withdrawal_limit: null,
    ytd_contributions: 0,
    ytd_withdrawals: 0,
    lifetime_contributions: 0,
    lifetime_withdrawals: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('filter helpers', () => {
  it('removes empty filters before filtering accounts', () => {
    expect(getActiveFilters({
      institution_id: [],
      account_kind: ['asset'],
      account_type: undefined,
    })).toEqual({ account_kind: ['asset'] })
  })

  it('derives sorted and present-only filter options', () => {
    const rows = [
      createAccount({
        id: 'checking',
        account_kind: 'asset',
        account_type: 'checking',
        institution: createInstitution('z', 'Zeta Bank'),
      }),
      createAccount({
        id: 'card',
        account_kind: 'revolving',
        account_type: 'credit_card',
        institution: createInstitution('a', 'Alpha Bank'),
      }),
      createAccount({
        id: 'cash',
        account_kind: 'asset',
        account_type: 'cash',
        institution: createInstitution('z', 'Zeta Bank'),
      }),
    ]

    expect(getInstitutionOptions(rows).map((option) => option.label)).toEqual([
      'Alpha Bank',
      'Zeta Bank',
    ])
    expect(getKindOptions(rows).map((option) => option.value)).toEqual([
      'asset',
      'revolving',
    ])
    expect(getTypeOptions(rows).map((option) => option.value)).toEqual([
      'checking',
      'cash',
      'credit_card',
    ])
  })

  it('applies institution, kind, and type filters together', () => {
    const rows = [
      createAccount({
        id: 'checking',
        account_kind: 'asset',
        account_type: 'checking',
        institution: createInstitution('bank', 'Bank'),
      }),
      createAccount({
        id: 'card',
        account_kind: 'revolving',
        account_type: 'credit_card',
        institution: createInstitution('bank', 'Bank'),
      }),
      createAccount({
        id: 'cash',
        account_kind: 'asset',
        account_type: 'cash',
        institution: null,
      }),
    ]

    expect(getFilteredRows(rows, {
      institution_id: ['bank'],
      account_kind: ['asset'],
      account_type: ['checking'],
    }, '').map((account) => account.id)).toEqual(['checking'])
  })

  it('keeps accounts matching any selected value within a facet', () => {
    const rows = [
      createAccount({ id: 'checking', account_type: 'checking' }),
      createAccount({ id: 'cash', account_type: 'cash' }),
      createAccount({ id: 'savings', account_type: 'savings' }),
    ]

    expect(getFilteredRows(rows, { account_type: ['checking', 'cash'] }, '').map((account) => account.id))
      .toEqual(['checking', 'cash'])
  })

  it('narrows accounts by search across name and institution, ignoring case', () => {
    const rows = [
      createAccount({ id: 'everyday', name: 'Everyday Chequing', institution: createInstitution('td', 'TD') }),
      createAccount({ id: 'rainy', name: 'Rainy Day', institution: createInstitution('rbc', 'RBC') }),
    ]

    expect(getFilteredRows(rows, {}, 'everyday').map((account) => account.id)).toEqual(['everyday'])
    expect(getFilteredRows(rows, {}, 'rbc').map((account) => account.id)).toEqual(['rainy'])
  })
})

describe('summary FX status messages', () => {
  it('explains incomplete account totals when some conversion rates are missing', () => {
    expect(getAccountSummaryFxStatusMessage({
      state: 'incomplete',
      missing_pairs: [{ base: 'USD', quote: 'CAD' }],
    })).toBe('Some foreign currency accounts could not be converted. Account totals are incomplete and only include accounts with available conversion rates')
  })

  it('explains unavailable row-level account balance conversion', () => {
    expect(getAccountBalanceFxStatusMessage({
      state: 'unavailable',
      missing_pairs: [{ base: 'USD', quote: 'CAD' }],
    })).toBe('This account balance could not be converted into your base currency')
  })
})

describe('account section helpers', () => {
  it('uses base-currency balances for totals and sorts visible rows by section rules', () => {
    const rows = [
      createAccount({
        id: 'savings',
        account_kind: 'asset',
        account_type: 'savings',
        current_balance: 300,
        base_currency_current_balance: 900,
      }),
      createAccount({
        id: 'checking',
        account_kind: 'asset',
        account_type: 'checking',
        current_balance: 700,
      }),
      createAccount({
        id: 'card',
        account_kind: 'revolving',
        account_type: 'credit_card',
        current_balance: -500,
      }),
      createAccount({
        id: 'loan',
        account_kind: 'amortizing',
        account_type: 'loan',
        current_balance: -4_000,
      }),
    ]
    const sections = getAccountSections({ rows, filteredRows: rows })

    expect(sections.totalAssets).toBe(1_600)
    expect(sections.totalDebts).toBe(-4_500)
    expect(sections.netWorth).toBe(-2_900)
    expect(sections.assetRows.map((account) => account.id)).toEqual(['savings', 'checking'])
    expect(sections.revolvingRows.map((account) => account.id)).toEqual(['card'])
    expect(sections.amortizingRows.map((account) => account.id)).toEqual(['loan'])
  })

  it('combines duplicate missing FX pairs once and keeps incomplete status when some conversions are unavailable', () => {
    const rows = [
      createAccount({
        id: 'cad',
        current_balance_fx_status: {
          state: 'incomplete',
          missing_pairs: [{ base: 'USD', quote: 'CAD' }],
        },
      }),
      createAccount({
        id: 'eur',
        current_balance_fx_status: {
          state: 'unavailable',
          missing_pairs: [
            { base: 'USD', quote: 'CAD' },
            { base: 'USD', quote: 'EUR' },
          ],
        },
      }),
      createAccount({ id: 'usd' }),
    ]

    expect(getCombinedAccountFxStatus(rows)).toEqual({
      state: 'incomplete',
      missing_pairs: [
        { base: 'USD', quote: 'CAD' },
        { base: 'USD', quote: 'EUR' },
      ],
    })
  })
})

describe('account metric helpers', () => {
  it('formats savings rate empty states for accounts with expenses and no income', () => {
    const savingsRate: AccountsMetricsViewModel['savingsRate'] = {
      value: null,
      hasExpenses: true,
      isLoading: false,
      net: -5_000,
      income: 0,
      progress: 0,
      color: 'var(--app-negative)',
      fxStatus: undefined,
    }

    expect(getSavingsRateDisplay(savingsRate, 'USD')).toEqual({
      value: '−∞%',
      caption: 'No income this month',
    })
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
      fxStatus: { state: 'unavailable', missing_pairs: [] },
    }

    expect(getCreditUsageDisplay(creditUsage, 'USD')).toEqual({
      value: 'N/A',
      caption: 'FX unavailable',
    })
  })

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

    expect(getRunwayMetric(undefined, false, 'USD')).toMatchObject({
      months: null,
      progress: 0,
      caption: '',
    })
    expect(getRunwayMetric({ ...runway, months: null, reason: 'no_accounts' }, false, 'USD')).toMatchObject({
      caption: 'Choose accounts in Settings',
    })
    expect(getRunwayMetric(runway, false, 'USD')).toMatchObject({
      months: 7.4,
      caption: '$1,234.56/mth · 6 mths basis',
      progress: 100,
    })
  })
})

describe('tax-advantaged limit helpers', () => {
  it('bounds usage percentages and marks over-limit usage as negative', () => {
    expect(getTaxAdvantagedUsagePercent(125, 100)).toBe(100)
    expect(getTaxAdvantagedUsagePercent(-25, 100)).toBe(0)
    expect(getTaxAdvantagedUsageColor(125, 100)).toBe('var(--app-negative)')
    expect(getTaxAdvantagedUsageColor(100, 100)).toBe('var(--app-text-muted)')
  })

  it('formats compact meter values without losing the currency sign', () => {
    expect(formatTaxAdvantagedMeterMoney(123_456, 'USD')).toBe('$1K')
    expect(formatTaxAdvantagedMeterMoney(12_300_000, 'USD')).toBe('$123K')
  })

  it('shows lifetime available boundary only when accrued room is between used and the lifetime cap', () => {
    expect(getLifetimeAvailableBoundary(createTaxAdvantagedCategory({
      lifetime_contribution_limit: 10_000,
      accrued_lifetime_contribution_limit: 7_000,
      lifetime_contributions: 5_000,
    }))).toBe(7_000)

    expect(getLifetimeAvailableBoundary(createTaxAdvantagedCategory({
      lifetime_contribution_limit: 10_000,
      accrued_lifetime_contribution_limit: 4_000,
      lifetime_contributions: 5_000,
    }))).toBeNull()
  })

  it('detects categories with limit settings or recorded activity', () => {
    expect(hasTaxAdvantagedLimitTracking(createTaxAdvantagedCategory({}))).toBe(false)
    expect(hasTaxAdvantagedLimitTracking(createTaxAdvantagedCategory({
      current_year_withdrawal_limit: 0,
    }))).toBe(true)
    expect(hasTaxAdvantagedLimitTracking(createTaxAdvantagedCategory({
      ytd_contributions: 100,
    }))).toBe(true)
  })

  it('keeps limit summaries independent from account filters', () => {
    const bank = createInstitution('bank', 'Bank')
    const rows = [
      createAccount({
        id: 'fhsa',
        account_type: 'investment',
        institution: bank,
        tax_advantaged_category_id: 'fhsa',
      }),
      createAccount({
        id: 'rrsp',
        account_type: 'savings',
        institution: null,
        tax_advantaged_category_id: 'rrsp',
      }),
    ]
    const filteredRows = getFilteredRows(rows, { institution_id: ['bank'] }, '')
    const summaries = getTaxAdvantagedLimitSummaries(rows, [
      createTaxAdvantagedCategory({
        id: 'fhsa',
        current_year_contribution_limit: 800_000,
      }),
      createTaxAdvantagedCategory({
        id: 'rrsp',
        current_year_contribution_limit: 3_000_000,
      }),
    ])

    expect(filteredRows.map((account) => account.id)).toEqual(['fhsa'])
    expect(summaries.map((summary) => summary.plan.id)).toEqual(['fhsa', 'rrsp'])
  })
})

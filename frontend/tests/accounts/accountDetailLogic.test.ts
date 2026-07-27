/**
 * Tests account detail helper behaviour so chart, breakdown, and identity form rules cannot drift while the JSX is split apart
 */
import { describe, expect, it } from 'vitest'
import type {
  Account,
  AccountBalanceSnapshot,
  AccountMonthlyCashFlow,
  AccountSpendingBreakdown,
} from '@/api/accounts'
import type { Currency } from '@/api/currency'
import { getNextModalFieldTabStop } from '@/components/modal/focus'
import { EDIT_ACCOUNT_IDENTITY_FIELD_IDS } from '@/pages/accounts/detail/constants/accountDetail'
import { calendarDateMs } from '@/pages/accounts/detail/utils/calendarDate'
import {
  getBalanceChartSnapshot,
  getBalancePeriodDelta,
  getBalanceRangeWindow,
  getBalanceYearBoundary,
} from '@/pages/accounts/detail/utils/balanceChartViewModel'
import {
  createIdentityFormValues,
  getIdentityFieldErrors,
  getIdentityUpdatePayload,
} from '@/pages/accounts/detail/utils/identityForm'
import {
  getCashFlowDomainMax,
  getCompletedCashFlowAverage,
  getMonthlyCashFlowBars,
} from '@/pages/accounts/detail/utils/cashFlowChartViewModel'
import {
  appendOtherBreakdownRow,
  getBreakdownRowFillPercent,
  getBreakdownRows,
} from '@/pages/accounts/detail/utils/spendingBreakdownViewModel'
import { toISODate } from '@/pages/accounts/detail/utils/date'

const currencies: Currency[] = [
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
]

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? 'account',
    owner_id: null,
    group_id: null,
    account_kind: overrides.account_kind ?? 'asset',
    account_type: overrides.account_type ?? 'checking',
    tax_advantaged_category_id: overrides.tax_advantaged_category_id ?? null,
    name: overrides.name ?? 'Account',
    institution: overrides.institution ?? null,
    currency: overrides.currency ?? 'USD',
    current_balance: overrides.current_balance ?? 0,
    base_currency_current_balance: overrides.base_currency_current_balance ?? null,
    current_balance_fx_status: overrides.current_balance_fx_status ?? { state: 'none', missing_pairs: [] },
    credit_limit: overrides.credit_limit ?? null,
    is_archived: overrides.is_archived ?? false,
    closed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('identity form helpers', () => {
  it('creates editable form values from nullable backend account fields', () => {
    expect(createIdentityFormValues(createAccount({
      institution: {
        id: 'bank',
        status: 'active',
        name: 'Bank',
        country_code: 'US',
        website: 'https://bank.example.com',
        logo_url: null,
      },
      tax_advantaged_category_id: 'plan',
      credit_limit: 1_234,
      is_archived: true,
    }), currencies)).toEqual({
      name: 'Account',
      institution_id: 'bank',
      tax_advantaged_category_id: 'plan',
      credit_limit: '12.34',
      is_archived: true,
    })
  })

  it('validates required names and only checks credit limits for revolving accounts', () => {
    const form = createIdentityFormValues(createAccount(), currencies)

    expect(getIdentityFieldErrors({ ...form, name: '   ' }, false)).toEqual({
      name: 'Name is required.',
    })
    expect(getIdentityFieldErrors({ ...form, credit_limit: '-1' }, true)).toEqual({
      credit_limit: 'Credit limit must be zero or higher.',
    })
    expect(getIdentityFieldErrors({ ...form, credit_limit: '-1' }, false)).toEqual({})
  })

  it('builds update payloads without sending fields hidden for the account kind', () => {
    const form = {
      name: '  Travel Card  ',
      institution_id: '',
      tax_advantaged_category_id: 'plan',
      credit_limit: '1234.56',
      is_archived: true,
    }

    expect(getIdentityUpdatePayload({
      form,
      isRevolving: true,
      canLinkTaxAdvantagedCategory: false,
      currencies,
      accountCurrency: 'USD',
    })).toEqual({
      name: 'Travel Card',
      institution_id: null,
      is_archived: true,
      credit_limit: 123_456,
    })
    expect(getIdentityUpdatePayload({
      form,
      isRevolving: false,
      canLinkTaxAdvantagedCategory: true,
      currencies,
      accountCurrency: 'USD',
    })).toEqual({
      name: 'Travel Card',
      institution_id: null,
      is_archived: true,
      tax_advantaged_category_id: 'plan',
    })
  })

  it('round-trips a seeded credit limit back to the same stored minor units unchanged', () => {
    const account = createAccount({ account_kind: 'revolving', credit_limit: 123_456 })
    const form = createIdentityFormValues(account, currencies)

    expect(form.credit_limit).toBe('1234.56')
    expect(getIdentityUpdatePayload({
      form,
      isRevolving: true,
      canLinkTaxAdvantagedCategory: false,
      currencies,
      accountCurrency: 'USD',
    })).toEqual({
      name: 'Account',
      institution_id: null,
      is_archived: false,
      credit_limit: 123_456,
    })
  })

  it('wraps edit account modal Tab focus through field controls only', () => {
    const fieldTabStops = [
      EDIT_ACCOUNT_IDENTITY_FIELD_IDS.name,
      EDIT_ACCOUNT_IDENTITY_FIELD_IDS.institution,
      EDIT_ACCOUNT_IDENTITY_FIELD_IDS.taxAdvantagedCategory,
      EDIT_ACCOUNT_IDENTITY_FIELD_IDS.creditLimit,
      EDIT_ACCOUNT_IDENTITY_FIELD_IDS.archive,
      EDIT_ACCOUNT_IDENTITY_FIELD_IDS.deleteName,
    ]

    expect(getNextModalFieldTabStop(fieldTabStops, null, false)).toBe(EDIT_ACCOUNT_IDENTITY_FIELD_IDS.name)
    expect(getNextModalFieldTabStop(fieldTabStops, EDIT_ACCOUNT_IDENTITY_FIELD_IDS.name, false)).toBe(EDIT_ACCOUNT_IDENTITY_FIELD_IDS.institution)
    expect(getNextModalFieldTabStop(fieldTabStops, EDIT_ACCOUNT_IDENTITY_FIELD_IDS.institution, false)).toBe(EDIT_ACCOUNT_IDENTITY_FIELD_IDS.taxAdvantagedCategory)
    expect(getNextModalFieldTabStop(fieldTabStops, EDIT_ACCOUNT_IDENTITY_FIELD_IDS.deleteName, false)).toBe(EDIT_ACCOUNT_IDENTITY_FIELD_IDS.name)
    expect(getNextModalFieldTabStop(fieldTabStops, EDIT_ACCOUNT_IDENTITY_FIELD_IDS.name, true)).toBe(EDIT_ACCOUNT_IDENTITY_FIELD_IDS.deleteName)
  })
})

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

/**
 * Covers dashboard view-model helpers extracted from the dashboard widgets
 *
 * These tests catch regressions where dashboard rows, chart points, thresholds,
 * or summary values drift away from the business rules the widgets render
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { LatestBudgetUtilization } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { FxStatus } from '@/api/shared/fx'
import type { Transaction } from '@/api/transactions'
import type { RunwayResult } from '@/api/user'
import { formatDashboardShortDate } from '@/dashboard/utils/formatDashboardShortDate'
import { getCreditUsageSummary } from '@/dashboard/utils/getCreditUsageSummary'
import { getRecentActivityRows } from '@/dashboard/utils/getRecentActivityRows'
import { getRunwayCaption } from '@/dashboard/utils/getRunwayCaption'
import { getRunwaySegments } from '@/dashboard/utils/getRunwaySegments'
import {
  getSavingsRateChartData,
  getSavingsRateDisplay,
} from '@/dashboard/utils/getSavingsRateChartData'
import { getTopBudgetAttentionState } from '@/dashboard/utils/getTopBudgetAttentionState'
import { getTopBudgets } from '@/dashboard/utils/getTopBudgets'
import type { SavingsRateSeriesPoint } from '@/dashboard/types/dashboard'

const fxStatus: FxStatus = { state: 'none', missing_pairs: [] }

function createAccount(overrides: Partial<AccountsOverview>): AccountsOverview {
  return {
    id: 'account-default',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Default account',
    institution: null,
    currency: 'USD',
    current_balance: 0,
    base_currency_current_balance: null,
    current_balance_fx_status: fxStatus,
    credit_limit: null,
    is_archived: false,
    closed_at: null,
    ...overrides,
  }
}

function createTransaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'transaction-default',
    created_by_user_id: 'user-1',
    account_id: 'account-1',
    dt: '2026-01-05',
    merchant_id: null,
    merchant_name: null,
    category_id: 'category-expense',
    amount: -1250,
    account_amount: null,
    base_currency_amount: null,
    currency: 'USD',
    fx_rate: null,
    notes: null,
    created_at: '2026-01-05T12:00:00Z',
    updated_at: '2026-01-05T12:00:00Z',
    tag_ids: [],
    tags: [],
    ...overrides,
  }
}

function createCategory(overrides: Partial<Category>): Category {
  return {
    id: 'category-expense',
    group_id: null,
    owner_id: null,
    name: 'Dining',
    kind: 'expense',
    icon: null,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function createBudget(overrides: Partial<LatestBudgetUtilization>): LatestBudgetUtilization {
  return {
    budget_id: 'budget-default',
    base_budget_id: 'base-budget-default',
    name: 'Default budget',
    currency: 'USD',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    overall_limit: 1000,
    total_spent: 0,
    categories: [],
    fx_status: fxStatus,
    ...overrides,
  }
}

describe('dashboard logic helpers', () => {
  it('summarizes credit usage for used and remaining modes', () => {
    const credit = {
      credit_limit_total: 100000,
      credit_used: 75000,
      fx_status: fxStatus,
    }

    expect(getCreditUsageSummary(credit, 'used')).toMatchObject({
      utilization: 75,
      remainingPct: 25,
      displayPct: 75,
      displayAmount: 75000,
      hasCredit: true,
      tier: 'negative',
    })
    expect(getCreditUsageSummary(credit, 'available')).toMatchObject({
      displayPct: 25,
      displayAmount: 25000,
    })
  })

  it('builds savings rate chart data without hiding the current empty period', () => {
    const points: SavingsRateSeriesPoint[] = [
      {
        monthLabel: 'Jan',
        fullLabel: 'January 2026',
        rate: null,
        income: 0,
        expenses: 0,
        isCurrent: false,
      },
      {
        monthLabel: 'Feb',
        fullLabel: 'February 2026',
        rate: 125,
        income: 10000,
        expenses: -2500,
        isCurrent: false,
      },
      {
        monthLabel: 'Mar',
        fullLabel: 'March 2026',
        rate: null,
        income: 0,
        expenses: 0,
        isCurrent: true,
      },
    ]

    expect(getSavingsRateChartData(points, true)).toEqual([
      { ...points[1], chartRate: 100 },
      { ...points[2], chartRate: null },
    ])
    expect(getSavingsRateDisplay({
      ...points[0],
      income: 0,
      expenses: 500,
      chartRate: -100,
    })).toBe('−∞%')
  })

  it('builds runway captions and selected account bar segments', () => {
    const runway: RunwayResult = {
      months: 4,
      reason: null,
      avg_monthly_expense: 50000,
      months_covered: 3,
      liquid_balance: 400000,
      account_balances: [
        { account_id: 'cash', balance: 300000 },
        { account_id: 'savings', balance: 100000 },
        { account_id: 'archived', balance: 900000 },
      ],
      thresholds: { riskyBelowMonths: 1, healthyAtMonths: 3 },
      fx_status: fxStatus,
    }
    const accounts = [
      createAccount({ id: 'cash', name: 'Cash' }),
      createAccount({ id: 'savings', name: 'Savings' }),
      createAccount({ id: 'archived', name: 'Archived', is_archived: true }),
      createAccount({ id: 'debt', name: 'Debt', account_kind: 'revolving' }),
    ]

    expect(getRunwayCaption({ ...runway, reason: 'no_accounts' }, 'USD')).toBe('Choose accounts in Settings')
    expect(getRunwayCaption(runway, 'USD')).toContain('/mth · 3 mths basis')
    expect(getRunwaySegments(accounts, ['cash', 'savings', 'archived', 'debt'], runway)).toMatchObject([
      { id: 'cash', amount: 300000, pct: 75, centerPct: 37.5 },
      { id: 'savings', amount: 100000, pct: 25, centerPct: 87.5 },
    ])
  })

  it('ranks top budgets by exact utilization and maps attention thresholds', () => {
    const budgets = getTopBudgets([
      createBudget({
        budget_id: 'rounded-high',
        base_budget_id: 'base-rounded-high',
        name: 'Rounded high',
        total_spent: 504,
      }),
      createBudget({
        budget_id: 'rounded-low',
        base_budget_id: 'base-rounded-low',
        name: 'Rounded low',
        total_spent: 496,
      }),
      createBudget({
        budget_id: 'watch',
        base_budget_id: 'base-watch',
        name: 'Watch',
        total_spent: 800,
      }),
    ])

    expect(budgets.map((budget) => budget.budget_id)).toEqual(['watch', 'rounded-high', 'rounded-low'])
    expect(budgets.map((budget) => budget.usagePct)).toEqual([80, 50, 50])
    expect(getTopBudgetAttentionState(79).label).toBe('On track')
    expect(getTopBudgetAttentionState(80).label).toBe('Watch')
    expect(getTopBudgetAttentionState(100).label).toBe('Needs attention')
  })

  it('builds recent activity rows with category and title fallbacks', () => {
    const rows = getRecentActivityRows(
      [
        createTransaction({
          id: 'income',
          category_id: 'category-income',
          merchant_name: 'Payroll',
          amount: 250000,
        }),
        createTransaction({
          id: 'note-fallback',
          category_id: 'category-expense',
          merchant_name: null,
          notes: 'Coffee shop',
        }),
      ],
      [
        createCategory({ id: 'category-income', name: 'Salary', kind: 'income' }),
        createCategory({ id: 'category-expense', name: 'Dining', kind: 'expense' }),
      ],
    )

    expect(rows).toMatchObject([
      { title: 'Payroll', isIncome: true, category: { name: 'Salary' } },
      { title: 'Coffee shop', isIncome: false, category: { name: 'Dining' } },
    ])
  })

  it('formats compact dashboard dates from backend date strings', () => {
    expect(formatDashboardShortDate('2026-01-05')).toBe('Jan 5')
    expect(formatDashboardShortDate('bad-date')).toBe('Unknown')
  })
})

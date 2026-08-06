/**
 * Builders and shared records for the dashboard widget tests in this folder
 *
 * Each builder takes the fields the test cares about and fills the rest with values that keep the
 * record unremarkable, so an assertion only ever turns on what its own test set. The runway and
 * comparison records are whole rather than built, because two tests each read a different helper off
 * the same record and have to be looking at the same numbers for the pair to mean anything
 */
import type { AccountsOverview } from '@/api/accounts'
import type { LatestBudgetUtilization } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { SpendingComparisonResponse } from '@/api/dashboard'
import type { FxStatus } from '@/api/shared/fx'
import type { Transaction } from '@/api/transactions'
import type { RunwayResult } from '@/api/user'

export const fxStatus: FxStatus = { state: 'none', missing_pairs: [] }

export function createAccount(overrides: Partial<AccountsOverview>): AccountsOverview {
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

export function createTransaction(overrides: Partial<Transaction>): Transaction {
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
    counterparty_account_id: null,
    counterparty_account_scope: null,
    created_at: '2026-01-05T12:00:00Z',
    updated_at: '2026-01-05T12:00:00Z',
    tag_ids: [],
    tags: [],
    ...overrides,
  }
}

export function createCategory(overrides: Partial<Category>): Category {
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

export function createBudget(overrides: Partial<LatestBudgetUtilization>): LatestBudgetUtilization {
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

/**
 * Four months of runway over three accounts, one of them archived, so the caption and the bar
 * segments are read off the same figures
 */
export const runway: RunwayResult = {
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

/**
 * Five labelled slots against three current and four previous readings, so both the series and the
 * summary are read off the same gaps at the end of each list
 */
export const comparison: SpendingComparisonResponse = {
  range: 'MTD',
  slot_labels: ['1', '2', '3', '4', '5'],
  current: [100, 300, 600],
  previous: [200, 400, 900, 1200],
  fx_status: fxStatus,
}

/**
 * Builders and the currency table for the transaction modal tests in this folder
 *
 * Each builder takes the fields the test cares about and fills the rest with values that keep the
 * record unremarkable, so an assertion only ever turns on what its own test set
 */
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions'

export const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

/**
 * Creates a category fixture with the fields required by dropdown option helpers
 */
export function createCategory(overrides: Partial<Category>): Category {
  return {
    id: overrides.id ?? 'category',
    group_id: null,
    owner_id: null,
    name: overrides.name ?? 'Category',
    kind: overrides.kind ?? 'expense',
    icon: overrides.icon ?? null,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Creates an account overview fixture matching the account selector data shape
 */
export function createAccount(overrides: Partial<AccountsOverview>): AccountsOverview {
  return {
    id: overrides.id ?? 'account',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: overrides.name ?? 'Account',
    institution: null,
    currency: overrides.currency ?? 'CAD',
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: { state: 'complete', missing_pairs: [] },
    credit_limit: null,
    is_archived: false,
    closed_at: null,
    ...overrides,
  }
}

/**
 * Creates a transaction fixture with stable defaults for create and edit payload comparisons
 */
export function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id ?? 'transaction',
    created_by_user_id: 'user',
    account_id: overrides.account_id ?? 'checking',
    dt: overrides.dt ?? '2026-06-11',
    merchant_id: overrides.merchant_id ?? 'merchant',
    merchant_name: overrides.merchant_name ?? 'Merchant',
    category_id: overrides.category_id ?? 'groceries',
    amount: overrides.amount ?? -12345,
    account_amount: null,
    base_currency_amount: null,
    currency: overrides.currency ?? 'CAD',
    fx_rate: null,
    notes: overrides.notes ?? null,
    counterparty_account_id: overrides.counterparty_account_id ?? null,
    counterparty_account_scope: overrides.counterparty_account_scope ?? null,
    created_at: '2026-06-11T12:00:00Z',
    updated_at: '2026-06-11T12:00:00Z',
    tag_ids: overrides.tag_ids ?? [],
    tags: overrides.tags ?? [],
    ...overrides,
  }
}

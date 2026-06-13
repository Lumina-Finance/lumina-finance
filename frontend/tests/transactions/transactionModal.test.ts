/**
 * Tests transaction modal helper behaviour so refactors catch broken defaults, sign handling, validation, and API payload construction before the modal renders
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions'
import { buildCategoryOptions } from '@/pages/transactions/components/transaction-modal/utils/categories'
import { buildInitialTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/initialForm'
import {
  amountInputToMinorUnits,
  amountToInputString,
  applyTransactionDirection,
  getDirectionFromAmountInputSign,
} from '@/pages/transactions/components/transaction-modal/utils/money'
import {
  buildCreateTransactionPayload,
  buildUpdateTransactionPatch,
} from '@/pages/transactions/components/transaction-modal/utils/payloads'
import { validateTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/validation'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Creates a category fixture with the fields required by dropdown option helpers
 */
function createCategory(overrides: Partial<Category>): Category {
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
function createAccount(overrides: Partial<AccountsOverview>): AccountsOverview {
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
function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
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
    created_at: '2026-06-11T12:00:00Z',
    updated_at: '2026-06-11T12:00:00Z',
    tag_ids: overrides.tag_ids ?? [],
    tags: overrides.tags ?? [],
    ...overrides,
  }
}

describe('transaction modal helpers', () => {
  it('builds category options with the active kind first and sorted names within each kind', () => {
    expect(buildCategoryOptions([
      createCategory({ id: 'salary', name: 'Salary', kind: 'income', icon: '💵' }),
      createCategory({ id: 'rent', name: 'Rent', kind: 'expense' }),
      createCategory({ id: 'food', name: 'Food', kind: 'expense', icon: '🍽️' }),
      createCategory({ id: 'transfer', name: 'Transfer', kind: 'transfer' }),
    ], 'income')).toMatchObject([
      { value: 'salary', label: 'Salary', group: 'Income' },
      { value: 'food', label: 'Food', group: 'Expense' },
      { value: 'rent', label: 'Rent', group: 'Expense' },
      { value: 'transfer', label: 'Transfer', group: 'Transfer' },
    ])
  })

  it('keeps money conversion and sign-derived direction aligned with backend minor units', () => {
    expect(getDirectionFromAmountInputSign('+12-34')).toBe('debit')
    expect(amountToInputString(-12345, 2)).toBe('123.45')
    expect(amountInputToMinorUnits('123.45', 2)).toBe(12345)
    expect(applyTransactionDirection(12345, 'credit')).toBe(12345)
    expect(applyTransactionDirection(12345, 'debit')).toBe(-12345)
  })

  it('builds create defaults from the selected account and edit defaults from the stored transaction', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T15:30:00'))
    const categories = [createCategory({ id: 'groceries', kind: 'expense' })]
    const accounts = [createAccount({ id: 'checking', currency: 'CAD' })]

    expect(buildInitialTransactionForm({
      categories,
      currencies,
      selectableAccounts: accounts,
      defaultAccountId: 'checking',
    })).toMatchObject({
      account_id: 'checking',
      currency: 'CAD',
      date: '2026-06-13',
    })

    expect(buildInitialTransactionForm({
      transaction: createTransaction({
        category_id: 'groceries',
        amount: -9876,
        tags: [{ id: 'tax', group_id: null, name: 'Tax' }],
      }),
      categories,
      currencies,
      selectableAccounts: accounts,
    })).toMatchObject({
      kind: 'expense',
      direction: 'debit',
      amount: '98.76',
      tag_ids: ['tax'],
    })
  })

  it('validates required fields and positive amounts before creating payloads', () => {
    expect(validateTransactionForm({
      kind: 'expense',
      direction: 'debit',
      account_id: '',
      category_id: '',
      merchant_id: '',
      amount: '0',
      currency: '',
      notes: '',
      date: '',
      tag_ids: [],
    })).toEqual({
      account_id: 'Select an account',
      category_id: 'Select a category',
      merchant_id: 'Select or create a merchant',
      amount: 'Amount must be greater than zero',
      currency: 'Select a currency',
      date: 'Select a date',
    })

    expect(buildCreateTransactionPayload({
      kind: 'expense',
      direction: 'debit',
      account_id: 'checking',
      category_id: 'groceries',
      merchant_id: 'store',
      amount: '123.45',
      currency: 'CAD',
      notes: ' Weekly groceries ',
      date: '2026-06-11',
      tag_ids: ['tax'],
    }, 2)).toEqual({
      account_id: 'checking',
      dt: '2026-06-11',
      category_id: 'groceries',
      merchant_id: 'store',
      amount: -12345,
      currency: 'CAD',
      notes: 'Weekly groceries',
      tag_ids: ['tax'],
    })
  })

  it('builds minimal edit patches and returns null when the transaction is unchanged', () => {
    const transaction = createTransaction({
      tag_ids: ['tax', 'business'],
      tags: [
        { id: 'tax', group_id: null, name: 'Tax' },
        { id: 'business', group_id: null, name: 'Business' },
      ],
    })
    const unchangedForm = buildInitialTransactionForm({
      transaction,
      categories: [createCategory({ id: 'groceries' })],
      currencies,
      selectableAccounts: [createAccount({ id: 'checking' })],
    })

    expect(buildUpdateTransactionPatch(unchangedForm, transaction, 2)).toBeNull()
    expect(buildUpdateTransactionPatch({
      ...unchangedForm,
      amount: '200.00',
      direction: 'credit',
      tag_ids: ['business'],
    }, transaction, 2)).toEqual({
      amount: 20000,
      tag_ids: ['business'],
    })
  })
})

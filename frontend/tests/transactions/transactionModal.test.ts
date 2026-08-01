/**
 * Tests transaction modal helper behaviour so refactors catch broken defaults, sign handling, validation, and API payload construction before the modal renders
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions'
import { OUTSIDE_ACCOUNT_VALUE } from '@/pages/transactions/components/transaction-modal/constants'
import { buildCategoryOptions } from '@/pages/transactions/components/transaction-modal/utils/categories'
import { buildOtherAccountOptions } from '@/pages/transactions/components/transaction-modal/utils/options'
import { buildInitialTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/initialForm'
import {
  amountInputToMinorUnits,
  amountToInputString,
  applyTransactionDirection,
  getDirectionFromAmountInputSign,
} from '@/pages/transactions/components/transaction-modal/utils/money'
import {
  buildCreateTransactionPayload,
  buildSymmetricTransferPayloads,
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
    other_account_id: overrides.other_account_id ?? null,
    other_account_scope: overrides.other_account_scope ?? null,
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
      timeZone: undefined,
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
      timeZone: undefined,
    })).toMatchObject({
      kind: 'expense',
      direction: 'debit',
      amount: '98.76',
      tag_ids: ['tax'],
    })
  })

  it('opens a new transaction on the profile timezone day rather than the browser calendar', () => {
    vi.useFakeTimers()
    // Late evening in Toronto on 30 June, already 1 July in UTC, so a zone mix-up shows up as a
    // different day and a different month
    vi.setSystemTime(new Date('2026-07-01T02:00:00Z'))
    const options = {
      categories: [createCategory({ id: 'groceries', kind: 'expense' })],
      currencies,
      selectableAccounts: [createAccount({ id: 'checking', currency: 'CAD' })],
      defaultAccountId: 'checking',
    }

    expect(buildInitialTransactionForm({ ...options, timeZone: 'America/Toronto' }).date).toBe('2026-06-30')
    expect(buildInitialTransactionForm({ ...options, timeZone: 'UTC' }).date).toBe('2026-07-01')
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
      symmetric_transfer: false,
      other_account_id: '',
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
      symmetric_transfer: false,
      other_account_id: '',
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

  it('withholds the amount rather than scaling it by a guess when the currency list is missing', () => {
    const transaction = createTransaction({ amount: -500_000, currency: 'JPY' })
    const form = buildInitialTransactionForm({
      transaction,
      categories: [createCategory({ id: 'groceries' })],
      currencies: [],
      selectableAccounts: [createAccount({ id: 'checking' })],
      timeZone: undefined,
    })

    // Blank rather than 5000.00, which is what two assumed decimal places would have shown for ¥500,000
    expect(form.amount).toBe('')

    // A blank amount converts to zero, so leaving it out is what stops the save wiping the stored value
    expect(buildUpdateTransactionPatch(form, transaction, null)).toBeNull()
    expect(buildUpdateTransactionPatch({ ...form, notes: 'Checked' }, transaction, null))
      .toEqual({ notes: 'Checked' })

    // The rest of the form still has to pass, so the blank amount cannot block an edit to anything else
    expect(validateTransactionForm(form, { isAmountLocked: true })).toEqual({})
    expect(validateTransactionForm(form)).toEqual({ amount: 'Enter an amount' })
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
      timeZone: undefined,
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

  it('requires an other-account answer on every transfer that is not Balance Adjustment', () => {
    const transferForm = {
      kind: 'transfer' as const,
      direction: 'debit' as const,
      account_id: 'checking',
      category_id: 'transfer-out',
      merchant_id: 'store',
      amount: '50.00',
      currency: 'CAD',
      notes: '',
      date: '2026-06-11',
      tag_ids: [],
      symmetric_transfer: false,
      other_account_id: '',
    }

    // A transfer with no answer fails validation, on an edit as much as on a create, which is what
    // brings transactions recorded before the field existed onto the new footing
    expect(validateTransactionForm(transferForm).other_account_id)
      .toBe('Select where the money went')

    // Balance Adjustment has no other side, so it is never required
    expect(validateTransactionForm(
      transferForm,
      { isBalanceAdjustmentCategory: true },
    ).other_account_id).toBeUndefined()

    // Ticking the checkbox makes this field the receiving account, so it is the one field asked
    // for either way rather than a second one appearing beside it
    const symmetricForm = { ...transferForm, symmetric_transfer: true }
    expect(validateTransactionForm(symmetricForm).other_account_id).toBe('Select where the money went')

    // Answering it once the checkbox is ticked clears the requirement, same as the standalone case
    expect(validateTransactionForm(
      { ...symmetricForm, other_account_id: 'savings' },
    ).other_account_id).toBeUndefined()

    // Picking the transaction's own account as the other side is always rejected
    expect(validateTransactionForm(
      { ...transferForm, other_account_id: 'checking' },
    ).other_account_id).toBe('Choose a different account')
  })

  it('writes the pair into the one chosen account, each leg recording the other', () => {
    const baseForm = {
      kind: 'transfer' as const,
      direction: 'debit' as const,
      account_id: 'checking',
      category_id: 'transfer-out',
      merchant_id: 'store',
      amount: '50.00',
      currency: 'CAD',
      notes: '',
      date: '2026-06-11',
      tag_ids: [],
      symmetric_transfer: true,
      other_account_id: 'savings',
    }

    // The one account field is both what the pair is written to and what each leg records, so the
    // two can no longer disagree
    const [fromPayload, toPayload] = buildSymmetricTransferPayloads(baseForm, 2)
    expect(fromPayload).toMatchObject({
      account_id: 'checking',
      amount: -5000,
      other_account_id: 'savings',
      other_account_scope: 'tracked',
    })
    expect(toPayload).toMatchObject({
      account_id: 'savings',
      amount: 5000,
      other_account_id: 'checking',
      other_account_scope: 'tracked',
    })
  })

  it('splits the other-account selection into an id-and-scope pair for create and update payloads', () => {
    const transferForm = {
      kind: 'transfer' as const,
      direction: 'debit' as const,
      account_id: 'checking',
      category_id: 'transfer-out',
      merchant_id: 'store',
      amount: '50.00',
      currency: 'CAD',
      notes: '',
      date: '2026-06-11',
      tag_ids: [],
      symmetric_transfer: false,
      other_account_id: OUTSIDE_ACCOUNT_VALUE,
    }

    expect(buildCreateTransactionPayload(transferForm, 2)).toMatchObject({
      other_account_id: null,
      other_account_scope: 'outside',
    })
    expect(buildCreateTransactionPayload({ ...transferForm, other_account_id: 'savings' }, 2)).toMatchObject({
      other_account_id: 'savings',
      other_account_scope: 'tracked',
    })

    const transaction = createTransaction({
      category_id: 'transfer-out',
      other_account_id: 'savings',
      other_account_scope: 'tracked',
    })
    const unchangedForm = buildInitialTransactionForm({
      transaction,
      categories: [createCategory({ id: 'transfer-out', kind: 'transfer' })],
      currencies,
      selectableAccounts: [createAccount({ id: 'checking' })],
      timeZone: undefined,
    })

    // Untouched, so no patch at all
    expect(buildUpdateTransactionPatch(unchangedForm, transaction, 2)).toBeNull()

    // Recording a different account sends the new pair
    expect(buildUpdateTransactionPatch(
      { ...unchangedForm, other_account_id: 'joint-savings' },
      transaction,
      2,
    )).toMatchObject({ other_account_id: 'joint-savings', other_account_scope: 'tracked' })

    // Clearing the field back to unanswered sends nulls rather than omitting them
    expect(buildUpdateTransactionPatch(
      { ...unchangedForm, other_account_id: '' },
      transaction,
      2,
    )).toMatchObject({ other_account_id: null, other_account_scope: null })

    // Moving to a non-transfer category leaves the pair out entirely, since the backend clears it itself
    expect(buildUpdateTransactionPatch(
      { ...unchangedForm, kind: 'expense', category_id: 'groceries' },
      transaction,
      2,
    )).toEqual({ category_id: 'groceries' })
  })

})

describe('other-account options', () => {
  const accounts = [
    createAccount({ id: 'checking', name: 'Chequing' }),
    createAccount({ id: 'savings', name: 'Savings' }),
  ]

  it('offers the outside entry first and leaves out the account holding the transfer', () => {
    const options = buildOtherAccountOptions(accounts, 'checking', false)

    expect(options.map((option) => option.value)).toEqual([OUTSIDE_ACCOUNT_VALUE, 'savings'])
  })

  it('drops the outside entry once the pair checkbox is ticked, since a transaction is written there', () => {
    const options = buildOtherAccountOptions(accounts, 'checking', true)

    expect(options.map((option) => option.value)).toEqual(['savings'])
  })

  it('offers no way back to unanswered, since every edit has to answer', () => {
    const options = buildOtherAccountOptions(accounts, 'checking', false)

    expect(options.some((option) => option.value === '')).toBe(false)
  })

  it('still records an archived account, which is a fact about money that already moved', () => {
    const withArchived = [...accounts, createAccount({ id: 'old-tfsa', name: 'Old TFSA', is_archived: true })]

    const options = buildOtherAccountOptions(withArchived, 'checking', false)

    expect(options.map((option) => option.value)).toContain('old-tfsa')
  })

  it('drops an archived account once the pair checkbox is ticked, since it refuses a transaction', () => {
    const withArchived = [...accounts, createAccount({ id: 'old-tfsa', name: 'Old TFSA', is_archived: true })]

    const options = buildOtherAccountOptions(withArchived, 'checking', true)

    expect(options.map((option) => option.value)).toEqual(['savings'])
  })
})

/**
 * Tests Firefly III preview row construction so the review step shows journal rows exactly as the commit maps them into ledger transactions
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import type { CsvRow } from '@/pages/imports/types'
import { FIREFLY_NO_CATEGORY_SOURCE } from '@/api/firefly-imports'
import {
  buildFireflyPreviewRows,
  getFireflyImportedCategories,
  inferFireflyCategoryMappings,
} from '@/pages/imports/firefly/utils'

const institution: Institution = {
  id: 'bank',
  status: 'active',
  name: 'Bank',
  country_code: 'CA',
  website: 'https://bank.example',
  logo_url: null,
}

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'EUR', name: 'Euro', symbol: '€', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

/**
 * Creates an account overview fixture for preview account mapping
 */
function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: 'checking',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Chequing',
    institution: null,
    currency: 'CAD',
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
 * Creates a category fixture used by preview category mapping
 */
function createCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'groceries',
    group_id: null,
    owner_id: null,
    name: 'Groceries',
    kind: 'expense',
    icon: null,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const transferCategory = createCategory({ id: 'transfer', name: 'Transfer', kind: 'transfer', is_system: true })
const balanceAdjustmentCategory = createCategory({
  id: 'balance-adjustment',
  name: 'Balance Adjustment',
  kind: 'transfer',
  is_system: true,
})

/**
 * Creates a journal row fixture shaped like the parsed transactions export
 */
function createFireflyRow(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    journal_id: '1',
    type: 'Withdrawal',
    date: '2026-06-11 00:00:00',
    amount: '-12.34',
    currency_code: 'CAD',
    foreign_amount: '',
    foreign_currency_code: '',
    description: 'Weekly shop',
    source_name: 'Chequing',
    source_type: 'Asset account',
    destination_name: 'Market',
    destination_type: 'Expense account',
    category: 'Groceries',
    tags: '',
    notes: '',
    ...overrides,
  }
}

/**
 * Builds preview options around one existing CAD chequing account mapping
 */
function createOptions(overrides: Partial<Parameters<typeof buildFireflyPreviewRows>[0]> = {}) {
  const groceries = createCategory()
  return {
    rows: [createFireflyRow()],
    limit: 5,
    accountById: new Map([['checking', createAccount()]]),
    accountMappings: { Chequing: 'checking' },
    accountCreateDetails: {},
    institutionById: new Map([[institution.id, institution]]),
    categoryById: new Map([[groceries.id, groceries]]),
    categoryMappings: { Groceries: groceries.id },
    categoryCreateKinds: {},
    transferCategory,
    balanceAdjustmentCategory,
    currencies: CURRENCIES,
    ...overrides,
  }
}

describe('firefly preview rows', () => {
  it('maps a withdrawal to one negative row with the destination as merchant', () => {
    const rows = buildFireflyPreviewRows(createOptions())

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      accountName: 'Chequing',
      currency: 'CAD',
      dateLabel: 'June 11, 2026',
      category: { name: 'Groceries' },
      transaction: {
        account_id: 'checking',
        amount: -1234,
        merchant_name: 'Market',
        notes: 'Weekly shop',
      },
    })
  })

  it('maps a deposit to one positive row on a create-new destination account', () => {
    const rows = buildFireflyPreviewRows(createOptions({
      rows: [createFireflyRow({
        type: 'Deposit',
        amount: '250.00',
        currency_code: 'USD',
        source_name: 'Employer',
        source_type: 'Revenue account',
        destination_name: 'US Savings',
        destination_type: 'Asset account',
        category: 'Salary',
      })],
      accountMappings: { 'US Savings': CREATE_ACCOUNT_VALUE },
      accountCreateDetails: { 'US Savings': { accountType: 'savings', currency: 'usd', institutionId: 'bank' } },
      categoryMappings: { Salary: CREATE_CATEGORY_VALUE },
      categoryCreateKinds: { Salary: 'income' },
    }))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      accountName: 'US Savings',
      accountInstitution: institution,
      currency: 'USD',
      category: { name: 'Salary', kind: 'income' },
      transaction: {
        account_id: CREATE_ACCOUNT_VALUE,
        amount: 25000,
        merchant_name: 'Employer',
      },
    })
  })

  it('maps a row between two tracked accounts to transfer legs using the foreign amount on the cross-currency side', () => {
    const usSavings = createAccount({ id: 'us-savings', name: 'US Savings', currency: 'USD' })
    const rows = buildFireflyPreviewRows(createOptions({
      rows: [createFireflyRow({
        type: 'Transfer',
        amount: '-100.00',
        foreign_amount: '73.50',
        foreign_currency_code: 'USD',
        destination_name: 'US Savings',
        destination_type: 'Asset account',
        category: '',
      })],
      accountById: new Map([
        ['checking', createAccount()],
        ['us-savings', usSavings],
      ]),
      accountMappings: { Chequing: 'checking', 'US Savings': 'us-savings' },
    }))

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      accountName: 'Chequing',
      currency: 'CAD',
      category: { name: 'Transfer' },
      transaction: { amount: -10000, merchant_name: null },
    })
    expect(rows[1]).toMatchObject({
      accountName: 'US Savings',
      currency: 'USD',
      transaction: { amount: 7350, merchant_name: null },
    })

    // Each leg records the counterparty end, which is what keeps the pair out of a tax-advantaged
    // category's totals once it is imported
    expect(rows[0]).toMatchObject({
      counterpartyAccountName: 'US Savings',
      transaction: { counterparty_account_id: 'us-savings', counterparty_account_scope: 'tracked' },
    })
    expect(rows[1]).toMatchObject({
      counterpartyAccountName: 'Chequing',
      transaction: { counterparty_account_id: 'checking', counterparty_account_scope: 'tracked' },
    })
  })

  // Every account is new on a first import, so this is the ordinary case rather than an edge one
  it('shows a transfer between two accounts queued for creation under their imported names', () => {
    const rows = buildFireflyPreviewRows(createOptions({
      rows: [createFireflyRow({
        type: 'Transfer',
        amount: '-100.00',
        destination_name: 'Savings',
        destination_type: 'Asset account',
        category: '',
      })],
      accountById: new Map(),
      accountMappings: { Chequing: CREATE_ACCOUNT_VALUE, Savings: CREATE_ACCOUNT_VALUE },
      accountCreateDetails: {
        Chequing: { accountType: 'checking', currency: 'CAD', institutionId: '' },
        Savings: { accountType: 'savings', currency: 'CAD', institutionId: '' },
      },
    }))

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      counterpartyAccountName: 'Savings',
      transaction: { counterparty_account_scope: 'tracked' },
    })
    expect(rows[1]).toMatchObject({
      counterpartyAccountName: 'Chequing',
      transaction: { counterparty_account_scope: 'tracked' },
    })
  })

  // A journal row with one imported endpoint has no second account to record, which is what money
  // leaving the app means, and the commit writes the same
  it('shows a transfer-category row with one imported endpoint as leaving the app', () => {
    const transfer = createCategory({ id: 'transfer', name: 'Transfer', kind: 'transfer', is_system: true })
    const rows = buildFireflyPreviewRows(createOptions({
      rows: [createFireflyRow({ category: 'Moving money out' })],
      categoryById: new Map([[transfer.id, transfer]]),
      categoryMappings: { 'Moving money out': transfer.id },
    }))

    expect(rows).toHaveLength(1)
    expect(rows[0].transaction.counterparty_account_id).toBeNull()
    expect(rows[0].transaction.counterparty_account_scope).toBe('outside')
  })

  it('maps balance rows to one adjustment leg signed by the tracked side', () => {
    const rows = buildFireflyPreviewRows(createOptions({
      rows: [
        createFireflyRow({
          journal_id: '10',
          type: 'Opening balance',
          amount: '500.00',
          source_name: 'Chequing initial balance',
          source_type: 'Initial balance account',
          destination_name: 'Chequing',
          destination_type: 'Asset account',
          category: '',
        }),
        createFireflyRow({
          journal_id: '11',
          type: 'Reconciliation',
          amount: '25.00',
          source_name: 'Chequing',
          source_type: 'Asset account',
          destination_name: 'Chequing reconciliation',
          destination_type: 'Reconciliation account',
          category: '',
        }),
      ],
    }))

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      category: { name: 'Balance Adjustment' },
      transaction: { amount: 50000 },
    })
    expect(rows[1]).toMatchObject({
      category: { name: 'Balance Adjustment' },
      transaction: { amount: -2500 },
    })
  })

  it('excludes rows the commit would skip', () => {
    const rows = buildFireflyPreviewRows(createOptions({
      rows: [
        createFireflyRow({ journal_id: '20', type: 'Invalid type' }),
        createFireflyRow({
          journal_id: '21',
          type: 'Transfer',
          destination_name: 'Untracked Wallet',
          destination_type: 'Expense account',
        }),
        createFireflyRow({ journal_id: '22', currency_code: 'USD' }),
        createFireflyRow({ journal_id: '23' }),
      ],
    }))

    expect(rows).toHaveLength(1)
    expect(rows[0].transaction.id).toContain('23')
  })

  it('caps the sample at the preview limit', () => {
    const rows = buildFireflyPreviewRows(createOptions({
      rows: Array.from({ length: 4 }, (_, index) => createFireflyRow({ journal_id: `${index + 1}` })),
      limit: 2,
    }))

    expect(rows).toHaveLength(2)
  })
})

describe('getFireflyImportedCategories', () => {
  it('lists the distinct categories rows carry', () => {
    const rows = [
      createFireflyRow({ category: 'Groceries' }),
      createFireflyRow({ category: 'Dining' }),
      createFireflyRow({ category: 'Groceries' }),
    ]

    expect(getFireflyImportedCategories(rows)).toEqual(['Dining', 'Groceries'])
  })

  it('adds the no-category placeholder when a row carries no category', () => {
    const rows = [createFireflyRow({ category: 'Groceries' }), createFireflyRow({ category: '' })]

    expect(getFireflyImportedCategories(rows)).toEqual(['Groceries', FIREFLY_NO_CATEGORY_SOURCE])
  })
})

describe('inferFireflyCategoryMappings', () => {
  it('matches the no-category placeholder to the seeded miscellaneous category', () => {
    const miscellaneous = createCategory({
      id: 'miscellaneous',
      name: 'Miscellaneous',
      kind: 'expense',
      is_system: true,
    })

    const mappings = inferFireflyCategoryMappings(
      [FIREFLY_NO_CATEGORY_SOURCE],
      {},
      [miscellaneous],
      { [FIREFLY_NO_CATEGORY_SOURCE]: 'expense' },
    )

    expect(mappings[FIREFLY_NO_CATEGORY_SOURCE]).toBe('miscellaneous')
  })

  it('keeps an explicit choice for the placeholder over the automatic match', () => {
    const miscellaneous = createCategory({ id: 'miscellaneous', name: 'Miscellaneous', is_system: true })
    const chosen = createCategory({ id: 'chosen', name: 'Shopping' })

    const mappings = inferFireflyCategoryMappings(
      [FIREFLY_NO_CATEGORY_SOURCE],
      { [FIREFLY_NO_CATEGORY_SOURCE]: 'chosen' },
      [miscellaneous, chosen],
      { [FIREFLY_NO_CATEGORY_SOURCE]: 'expense' },
    )

    expect(mappings[FIREFLY_NO_CATEGORY_SOURCE]).toBe('chosen')
  })
})

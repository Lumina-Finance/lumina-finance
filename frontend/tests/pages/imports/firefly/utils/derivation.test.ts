/**
 * Tests Firefly account currency prefills, imported category listing and category mappings
 *
 * Create-new prefills must only offer a currency the app can store an
 * account in, since the count above the mapping table reads a row carrying a type and a currency as
 * answered while the control beside it shows a placeholder for a code its own list does not hold
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { FIREFLY_NO_CATEGORY_SOURCE } from '@/api/firefly-imports'
import type { CsvRow } from '@/pages/imports/types'
import {
  buildFireflyAccountPrefills,
  getFireflyAccountSources,
  getFireflyImportedCategories,
  inferFireflyCategoryMappings,
  readFireflyAccountDetails,
} from '@/pages/imports/firefly/utils'
import { createNameKeyedAccountSources } from './fixtures'

const SUPPORTED_CURRENCIES = new Set(['CAD', 'USD'])

/**
 * Creates a category fixture used by category derivation
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

/**
 * Creates a Firefly withdrawal leaving the given asset account in the given currency
 */
function createWithdrawal(sourceName: string, currencyCode: string, overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    journal_id: '1',
    type: 'Withdrawal',
    date: '2026-06-11 00:00:00',
    amount: '-12.34',
    currency_code: currencyCode,
    foreign_amount: '',
    foreign_currency_code: '',
    description: 'Weekly shop',
    source_name: sourceName,
    source_type: 'Asset account',
    destination_name: 'Market',
    destination_type: 'Expense account',
    category: 'Groceries',
    tags: '',
    notes: '',
    ...overrides,
  }
}

describe('the currency a Firefly account is prefilled with', () => {
  it('takes the code every row of the account states', () => {
    const rows = [createWithdrawal('Chequing', 'CAD'), createWithdrawal('Chequing', 'CAD')]

    expect(buildFireflyAccountPrefills(rows, createNameKeyedAccountSources(['Chequing']), SUPPORTED_CURRENCIES).Chequing.currency).toBe('CAD')
  })

  // Three characters is all the export is asked for, so a code the app cannot store an account in
  // reaches here. Prefilled, it would leave the row counted as answered with an empty-looking
  // currency box, and the commit would send the server a currency it refuses
  it('leaves the box empty for a code the app does not support', () => {
    const rows = [createWithdrawal('Crypto Wallet', 'BTC'), createWithdrawal('Crypto Wallet', 'BTC')]

    expect(buildFireflyAccountPrefills(rows, createNameKeyedAccountSources(['Crypto Wallet']), SUPPORTED_CURRENCIES)['Crypto Wallet'].currency).toBe('')
  })

  // The overall vote stands in for an account whose own rows say nothing, so an unsupported code
  // must not win there either
  it('does not let an unsupported code become the fallback for another account', () => {
    const rows = [
      createWithdrawal('Crypto Wallet', 'BTC'),
      createWithdrawal('Crypto Wallet', 'BTC'),
      createWithdrawal('Chequing', 'CAD'),
    ]

    const prefills = buildFireflyAccountPrefills(rows, createNameKeyedAccountSources(['Crypto Wallet', 'Savings']), SUPPORTED_CURRENCIES)
    expect(prefills.Savings.currency).toBe('CAD')
  })

  it('ignores an unsupported foreign currency on a transfer', () => {
    const rows = [
      createWithdrawal('Chequing', 'CAD', {
        type: 'Transfer',
        destination_name: 'Savings',
        destination_type: 'Asset account',
        foreign_currency_code: 'BTC',
      }),
    ]

    expect(buildFireflyAccountPrefills(rows, createNameKeyedAccountSources(['Savings']), SUPPORTED_CURRENCIES).Savings.currency).toBe('CAD')
  })
})

describe('getFireflyImportedCategories', () => {
  it('lists the distinct categories rows carry', () => {
    const rows = [
      createWithdrawal('Chequing', 'CAD', { category: 'Groceries' }),
      createWithdrawal('Chequing', 'CAD', { category: 'Dining' }),
      createWithdrawal('Chequing', 'CAD', { category: 'Groceries' }),
    ]

    expect(getFireflyImportedCategories(rows)).toEqual(['Dining', 'Groceries'])
  })

  it('adds the no-category placeholder when a row carries no category', () => {
    const rows = [
      createWithdrawal('Chequing', 'CAD', { category: 'Groceries' }),
      createWithdrawal('Chequing', 'CAD', { category: '' }),
    ]

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

describe('the accounts the Firefly III accounts export adds to', () => {
  const row = (source: string, sourceType: string): CsvRow => ({
    journal_id: '1',
    type: 'withdrawal',
    date: '2026-06-11',
    amount: '-10.00',
    currency_code: 'CAD',
    source_name: source,
    source_type: sourceType,
    destination_name: 'Market',
    destination_type: 'Expense account',
  })
  const ROWS = [row('Boat', 'Asset account'), row('Boat', 'Loan'), row('@Home Fund', 'Asset account')]

  // Written the way the accounts export differs from the transactions export: its own type casing
  // and spacing around a name
  const ACCOUNT_ROWS: CsvRow[] = [
    { type: 'Asset account', name: 'Boat', active: '1', currency_code: 'CAD', role: 'ccAsset' },
    { type: 'Loan', name: 'Boat', active: '1', currency_code: 'CAD', role: '' },
    { type: 'asset account', name: ' @Home Fund ', active: '', currency_code: 'usd', role: 'savingAsset' },
    { type: 'Asset account', name: 'Rainy Day', active: '1', currency_code: 'CHF', role: 'savingAsset' },
    { type: 'Expense account', name: 'Market', active: '1', currency_code: '', role: '' },
  ]

  it('lists each account once, keeps the ids the rows give, and numbers the accounts only it lists apart', () => {
    const withoutFile = getFireflyAccountSources(ROWS, null)
    const withFile = getFireflyAccountSources(ROWS, readFireflyAccountDetails(ACCOUNT_ROWS))

    expect(withFile.list.map(({ id, label }) => [id, label])).toEqual([
      ...withoutFile.list.map(({ id, label }) => [id, label]),
      ['listed-account-1', 'Rainy Day'],
    ])
    expect(withFile.find('@Home Fund', 'Asset account')?.details).toMatchObject({ isActive: false, role: 'savingAsset' })
    expect(withFile.find('Boat', 'Loan')?.details).toMatchObject({ isActive: true })
  })

  it('proposes each account as its role and in its own currency, leaving a currency the app lacks blank', () => {
    const sources = getFireflyAccountSources(ROWS, readFireflyAccountDetails(ACCOUNT_ROWS))
    const prefills = buildFireflyAccountPrefills(ROWS, sources, SUPPORTED_CURRENCIES)
    const prefillOf = (name: string, type: string) => prefills[sources.find(name, type)!.id]

    expect(prefillOf('Boat', 'Asset account')).toEqual({ accountType: 'credit_card', currency: 'CAD' })
    expect(prefillOf('Boat', 'Loan')).toEqual({ accountType: 'loan', currency: 'CAD' })
    expect(prefillOf('@Home Fund', 'Asset account')).toEqual({ accountType: 'savings', currency: 'USD' })
    expect(prefills['listed-account-1']).toEqual({ accountType: 'savings', currency: '' })
  })
})

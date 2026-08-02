/**
 * Tests import workflow option helpers so dropdown ordering, file-name account fallbacks, and imported value lists stay stable after hook refactors
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import {
  buildImportAccountMappingSources,
  buildImportAccountOptions,
  buildImportCategoryMatchOptions,
  buildImportCurrencyOptions,
  buildImportInstitutionOptions,
  getImportedCategories,
  getImportedMerchants,
  getImportedTags,
  getImportHeaders,
  getMissingRequiredColumnLabels,
} from '@/pages/imports/utils'

/**
 * Creates an account overview fixture for option grouping
 */
function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: overrides.id ?? 'checking',
    owner_id: null,
    group_id: null,
    account_kind: overrides.account_kind ?? 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: overrides.name ?? 'Checking',
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
 * Creates a category fixture for category match options
 */
function createCategory(overrides: Partial<Category> = {}): Category {
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
 * Creates an import file draft with representative rows
 */
function createFile(overrides: Partial<ImportFileDraft> = {}): ImportFileDraft {
  return {
    id: overrides.id ?? 'file-1',
    name: overrides.name ?? 'Checking.csv',
    size: 1024,
    headers: overrides.headers ?? ['Account', 'Category', 'Merchant', 'Tags'],
    hasHeaderRow: true,
    rows: overrides.rows ?? [],
    error: null,
    ...overrides,
  }
}

describe('import workflow option helpers', () => {
  it('builds dropdown options with action and none choices pinned first', () => {
    const currencies: Currency[] = [
      { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
    ]
    const institutions: Institution[] = [
      { id: 'bank', status: 'active', name: 'Bank', country_code: 'CA', website: '', logo_url: null },
    ]

    expect(buildImportAccountOptions([
      createAccount({ id: 'visa', name: 'Visa', account_kind: 'revolving' }),
    ])).toEqual([
      { value: CREATE_ACCOUNT_VALUE, label: 'Create New Account', group: 'Import Action' },
      { value: 'visa', label: 'Visa', group: 'Revolving Credit' },
    ])
    expect(buildImportCurrencyOptions(currencies)).toEqual([{ value: 'CAD', label: 'CAD' }])
    expect(buildImportInstitutionOptions(institutions)).toEqual([
      { value: '', label: 'None' },
      { value: 'bank', label: 'Bank' },
    ])
  })

  it('sorts category match options by kind and name after the create action', () => {
    expect(buildImportCategoryMatchOptions([
      createCategory({ id: 'transfer', name: 'Between accounts', kind: 'transfer' }),
      createCategory({ id: 'salary', name: 'Salary', kind: 'income', icon: '💵' }),
      createCategory({ id: 'food', name: 'Food', kind: 'expense' }),
      createCategory({ id: 'rent', name: 'Rent', kind: 'expense' }),
    ])).toMatchObject([
      { value: CREATE_CATEGORY_VALUE, label: 'Create new category', group: 'Import action' },
      { value: 'food', label: 'Food', group: 'Expense' },
      { value: 'rent', label: 'Rent', group: 'Expense' },
      { value: 'salary', label: 'Salary', group: 'Income' },
      { value: 'transfer', label: 'Between accounts', group: 'Transfer' },
    ])
  })

  it('derives headers, required-column gaps, account sources, and imported values from files', () => {
    const files = [
      createFile({
        id: 'checking-file',
        name: 'Chequing Activity.csv',
        headers: ['Account', 'Category', 'Tags'],
        rows: [
          { Account: 'Main', Category: 'Groceries', Merchant: 'Market', Tags: 'food, essentials' },
          { Account: 'Main', Category: 'Rent', Merchant: 'Landlord', Tags: 'housing' },
        ],
      }),
      createFile({
        id: 'visa-file',
        name: 'Visa.csv',
        headers: ['Account', 'Category', 'Merchant'],
        rows: [
          { Account: 'Visa', Category: 'Groceries', Merchant: 'Market', Tags: '' },
        ],
      }),
    ]

    expect(getImportHeaders(files)).toEqual(['Account', 'Category', 'Tags', 'Merchant'])
    expect(getMissingRequiredColumnLabels({ ...EMPTY_COLUMN_MAP, dt: 'Date' })).toContain('Amount')
    expect(buildImportAccountMappingSources(files, '', '')).toEqual([
      { id: 'checking-file', label: 'Chequing Activity', matchText: 'Chequing Activity.csv', isCounterpartyOnly: false },
      { id: 'visa-file', label: 'Visa', matchText: 'Visa.csv', isCounterpartyOnly: false },
    ])
    expect(buildImportAccountMappingSources(files, 'Account', '')).toEqual([
      { id: 'Main', label: 'Main', matchText: 'Main', isCounterpartyOnly: false },
      { id: 'Visa', label: 'Visa', matchText: 'Visa', isCounterpartyOnly: false },
    ])
    expect(getImportedCategories(files, 'Category')).toEqual(['Groceries', 'Rent'])
    expect(getImportedMerchants(files, 'Merchant')).toEqual(['Landlord', 'Market'])
    expect(getImportedTags(files, 'Tags')).toEqual(['essentials', 'food', 'housing'])
  })
})

/**
 * Tests import workflow option helpers so dropdown ordering, file-name account fallbacks, and imported value lists stay stable after hook refactors
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import {
  COLUMN_TARGETS,
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  CURRENCIES_FAILED_UPLOAD_BLOCK,
  CURRENCIES_LOADING_UPLOAD_BLOCK,
  EMPTY_COLUMN_MAP,
} from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import {
  buildColumnTargetOptions,
  buildImportAccountMappingSources,
  buildImportAccountOptions,
  buildImportCategoryMatchOptions,
  buildImportCurrencyOptions,
  buildImportInstitutionOptions,
  getArchivedAccountMatches,
  getImportedCategories,
  getImportedMerchants,
  getImportedTags,
  getImportHeaders,
  getImportUploadBlockReason,
  getMissingRequiredColumnLabels,
  getSupportedCurrencyCodes,
  inferAccountMappings,
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

  it('carries every field explanation into the column target options', () => {
    const options = buildColumnTargetOptions()

    // Ignoring a column explains itself, and it is the only entry outside the two groups
    expect(options[0]).toEqual({ value: '', label: 'Do not import' })
    expect(options.slice(1).every((option) => Boolean(option.description))).toBe(true)
    expect(options.find((option) => option.value === 'merchant_id')?.description).toBe(
      COLUMN_TARGETS.find((target) => target.id === 'merchant_id')?.hint,
    )

    // Required fields are gathered ahead of the optional ones rather than following declaration order
    const groups = options.slice(1).map((option) => option.group)
    expect(groups.indexOf('Optional fields')).toBeGreaterThan(groups.lastIndexOf('Required fields'))
  })

  it('marks an archived account wherever it is offered', () => {
    const options = buildImportAccountOptions([
      createAccount({ id: 'savings', name: 'Old Savings', is_archived: true }),
      createAccount({ id: 'checking', name: 'Chequing' }),
    ])

    expect(options.find((option) => option.value === 'savings')?.badge).toBe('Archived')
    expect(options.find((option) => option.value === 'checking')?.badge).toBeUndefined()
  })

  it('gathers accounts by kind, so no heading is reached twice', () => {
    const options = buildImportAccountOptions([
      createAccount({ id: 'visa', name: 'Visa', account_kind: 'revolving' }),
      createAccount({ id: 'savings', name: 'Savings' }),
      createAccount({ id: 'mortgage', name: 'Mortgage', account_kind: 'amortizing' }),
      createAccount({ id: 'chequing', name: 'Chequing' }),
    ])

    // Creation order interleaves the kinds, and the dropdown heads a group every time the group
    // changes going down the list
    expect(options.map((option) => option.group)).toEqual([
      'Import Action',
      'Assets',
      'Assets',
      'Revolving Credit',
      'Amortizing Debt',
    ])
    expect(options.map((option) => option.label)).toEqual([
      'Create New Account',
      'Chequing',
      'Savings',
      'Visa',
      'Mortgage',
    ])
  })
})

describe('archived accounts in account mapping', () => {
  const archivedSavings = createAccount({ id: 'savings', name: 'Old Savings', is_archived: true })
  const chequing = createAccount({ id: 'checking', name: 'Chequing' })
  const rowSource = { id: 'Old Savings', label: 'Old Savings', matchText: 'Old Savings', isCounterpartyOnly: false }
  const counterpartySource = { ...rowSource, isCounterpartyOnly: true }

  it('matches a counterparty source to an archived account and leaves a row source unmapped', () => {
    const lists = { rowAccounts: [chequing], counterpartyAccounts: [chequing, archivedSavings] }

    expect(inferAccountMappings([counterpartySource], {}, lists)).toEqual({ 'Old Savings': 'savings' })
    expect(inferAccountMappings([rowSource], {}, lists)).toEqual({})
  })

  it('reports the archived account a row source was left unmapped by', () => {
    const accounts = [chequing, archivedSavings]

    expect(getArchivedAccountMatches([rowSource], {}, accounts)).toEqual(['Old Savings'])

    // Nothing to say once the source is answered, and nothing to say about a counterparty source,
    // which is offered the archived account in the first place
    expect(getArchivedAccountMatches([rowSource], { 'Old Savings': 'checking' }, accounts)).toEqual([])
    expect(getArchivedAccountMatches([counterpartySource], {}, accounts)).toEqual([])
    expect(getArchivedAccountMatches([rowSource], {}, [chequing])).toEqual([])
  })
})

describe('blocking the upload until the currency list is in hand', () => {
  const currencies: Currency[] = [
    { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  ]

  it('lets a file be uploaded once the list has arrived', () => {
    expect(getImportUploadBlockReason(currencies, false)).toBeNull()
  })

  it('blocks on an empty list, whether it failed or has simply not arrived', () => {
    // A request the browser has not started, which is what an offline page has, reports neither
    // loading nor failed, so the list itself is what decides rather than the request's state
    expect(getImportUploadBlockReason([], false)).toBe(CURRENCIES_LOADING_UPLOAD_BLOCK)
    expect(getImportUploadBlockReason([], true)).toBe(CURRENCIES_FAILED_UPLOAD_BLOCK)
  })

  it('says to reload only where the fetch actually failed', () => {
    expect(getImportUploadBlockReason([], true)).toContain('Reload the page')
    expect(getImportUploadBlockReason([], false)).not.toContain('Reload the page')
  })
})

describe('collecting the supported currency codes', () => {
  it('holds every code the list carries and nothing else', () => {
    const codes = getSupportedCurrencyCodes([
      { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
      { id: 'JPY', name: 'Japanese Yen', symbol: '\u00a5', minor_unit_exponent: 0 },
    ])

    expect(codes.has('CAD')).toBe(true)
    expect(codes.has('JPY')).toBe(true)
    expect(codes.has('ZZZ')).toBe(false)
    expect(codes.size).toBe(2)
  })
})

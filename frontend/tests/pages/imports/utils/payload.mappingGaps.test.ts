/**
 * Tests the mapping-answer error paths the commit payload builder reaches only through an unusual
 * combination of answers, plus the two payload shapes no test asserts directly: an account queued
 * for creation and a merchant answer that resolves, both success paths as unexercised as the
 * failures beside them
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  CREATE_MERCHANT_VALUE,
  EMPTY_COLUMN_MAP,
  getTooManyMappingsError,
  MAX_IMPORT_MAPPINGS,
} from '@/pages/imports/constants'
import type { ColumnMap, CsvRow, ImportAccountSource, ImportFileDraft } from '@/pages/imports/types'
import { buildTransactionImportPayload } from '@/pages/imports/utils'

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

const CATEGORY: Category = {
  id: 'category-1',
  group_id: null,
  owner_id: null,
  name: 'Groceries',
  kind: 'expense',
  icon: null,
  is_system: false,
  created_at: '2026-01-01T00:00:00Z',
}

const ACCOUNT: AccountsOverview = {
  id: 'account-1',
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
  can_write: true,
  is_archived: false,
  closed_at: null,
}

const COLUMN_MAP: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' }
const HEADERS = ['Date', 'Category', 'Amount']
const VALID_ROW: CsvRow = { Date: '2026-04-10', Category: 'Groceries', Amount: '-12.34' }

/**
 * Creates a one-file draft carrying the given rows under the file's usual headers
 */
function createFile(rows: CsvRow[], overrides: Partial<ImportFileDraft> = {}): ImportFileDraft {
  return { id: 'file-1', name: 'Chequing.csv', size: 512, headers: HEADERS, hasHeaderRow: true, rows, error: null, ...overrides }
}

/**
 * Creates a mapping source rows are written to, unless overridden
 */
function createSource(id: string, overrides: Partial<ImportAccountSource> = {}): ImportAccountSource {
  return { id, label: id, matchText: id, isCounterpartyOnly: false, ...overrides }
}

/**
 * Builds a commit payload for one row, defaulting to an import every answer already settles, so
 * each test overrides only the piece it means to put wrong
 */
function build(overrides: Partial<Parameters<typeof buildTransactionImportPayload>[0]> = {}) {
  return buildTransactionImportPayload({
    accountById: new Map([[ACCOUNT.id, ACCOUNT]]),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': ACCOUNT.id },
    accountSources: [createSource('file-1', { label: 'Chequing', matchText: 'Chequing' })],
    categoryById: new Map([[CATEGORY.id, CATEGORY]]),
    categoryCreateKinds: {},
    categoryMappings: { Groceries: CATEGORY.id },
    categoryTypesBySource: {},
    columnMap: COLUMN_MAP,
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    directionAnswers: {},
    files: [createFile([VALID_ROW])],
    importedCategories: ['Groceries'],
    ...overrides,
  })
}

describe('refusing an import with nothing to build a payload from', () => {
  it('refuses an import with no files', () => {
    const result = build({ files: [] })

    expect(result.errors).toEqual(['Upload a CSV file.'])
    expect(result.payload).toBeNull()
  })

  it('prefixes the error with the file it belongs to', () => {
    const result = build({ files: [createFile([], { error: 'A quoted value is never closed.' })] })

    expect(result.errors).toEqual(['Chequing.csv: A quoted value is never closed.'])
    expect(result.payload).toBeNull()
  })

  it('refuses a file with a heading row and no problems on any of its rows, since it has none', () => {
    const result = build({ files: [createFile([])] })

    expect(result.errors).toEqual(['This file has no transaction rows to import.'])
    expect(result.payload).toBeNull()
  })
})

describe('refusing an import for what the mapping step never asked', () => {
  it('lists the required columns still unmapped, asserted whole', () => {
    const result = build({ columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category' } })

    // The label states all three ways a file can carry its amount, so asserting only that the
    // message mentions Amount would pass on any wording at all
    expect(result.errors).toEqual(['Map the required columns: Amount (or Money out / Money in)'])
  })

  it('refuses an import declaring more account sources than it may carry, the counterpart of the category limit', () => {
    const sources = Array.from({ length: MAX_IMPORT_MAPPINGS + 1 }, (_, index) => createSource(`Source ${index}`))
    const result = build({ accountSources: sources, accountMappings: {} })

    expect(result.errors).toContain(getTooManyMappingsError('account', MAX_IMPORT_MAPPINGS + 1))
    expect(result.payload).toBeNull()
  })
})

describe('refusing a category or merchant answer the builder cannot use', () => {
  it('asks for a create-category source\'s kind before anything else about it', () => {
    const result = build({
      categoryMappings: { Groceries: CREATE_CATEGORY_VALUE },
      categoryCreateKinds: {},
      categoryTypesBySource: {},
    })

    expect(result.errors).toEqual(['Choose category type: Groceries'])
  })

  it('forwards a merchant answer the builder refuses, no test having passed this function one before', () => {
    const result = build({
      merchantAnswers: {
        importedMerchants: ['Acme'],
        matchedMerchantByKey: new Map(),
        merchantMappings: { Acme: CREATE_MERCHANT_VALUE },
        merchantCreateNames: { Acme: '   ' },
      },
    })

    expect(result.errors).toContain('Choose a name for the new merchant: Acme')
  })
})

describe('refusing an account mapping answer', () => {
  it('asks to map an account source with no answer at all', () => {
    const result = build({ accountMappings: {} })

    expect(result.errors).toEqual(['Map account: Chequing'])
  })

  // The type-support check can only be reached once both fields are answered, so a second source
  // carrying a currency and an unsupported type is what proves the function ever reaches it
  it('asks for both create-account fields before it can reach the type-support check on a second source', () => {
    const result = build({
      accountSources: [
        createSource('blank-source', { label: 'Blank Source', matchText: 'Blank Source' }),
        createSource('bad-type-source', { label: 'Bad Type Source', matchText: 'Bad Type Source' }),
      ],
      accountMappings: { 'blank-source': CREATE_ACCOUNT_VALUE, 'bad-type-source': CREATE_ACCOUNT_VALUE },
      accountCreateCurrencies: { 'bad-type-source': 'CAD' },
      accountCreateTypes: { 'bad-type-source': 'not-a-real-type' },
    })

    expect(result.errors).toContain('Choose account type: Blank Source')
    expect(result.errors).toContain('Choose account currency: Blank Source')
    expect(result.errors).toContain('Choose an account type this app supports: Bad Type Source')
  })
})

describe('carrying a resolved mapping through to the payload', () => {
  it('carries a fully answered create-account source through as a create entry', () => {
    const result = build({
      accountCreateTypes: { 'file-1': 'checking' },
      accountCreateCurrencies: { 'file-1': 'CAD' },
      accountCreateInstitutions: { 'file-1': 'inst-1' },
      accountMappings: { 'file-1': CREATE_ACCOUNT_VALUE },
    })

    expect(result.errors).toEqual([])
    expect(result.payload?.accounts).toContainEqual({
      source: 'file-1',
      create: { name: 'Chequing', account_type: 'checking', currency: 'CAD', institution_id: 'inst-1' },
    })
  })

  it('carries an existing-category source through as a category_id entry', () => {
    const result = build()

    expect(result.errors).toEqual([])
    expect(result.payload?.categories).toEqual([{ source: 'Groceries', category_id: CATEGORY.id }])
  })

  it('carries a merchant answer that resolves into the payload', () => {
    const result = build({
      merchantAnswers: {
        importedMerchants: ['Acme'],
        matchedMerchantByKey: new Map(),
        merchantMappings: { Acme: CREATE_MERCHANT_VALUE },
        merchantCreateNames: { Acme: 'Acme Store' },
      },
    })

    expect(result.errors).toEqual([])
    expect(result.payload?.merchants).toEqual([{ source: 'Acme', create: { name: 'Acme Store' } }])
  })
})

/**
 * Tests what the importer does with a row whose file states no payee: it imports under a merchant
 * that ships with the app, the preview shows which one, and the mapping step says how many rows
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  EMPTY_COLUMN_MAP,
  getRowsWithNoPayeeExplanation,
  SELF_MERCHANT_NAME,
  UNKNOWN_MERCHANT_NAME,
} from '@/pages/imports/constants'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import {
  buildImportPreviewRows,
  buildTransactionImportPayload,
  countRowsWithNoPayee,
} from '@/pages/imports/utils'

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

const ACCOUNT = { id: 'account-1', name: 'Chequing', currency: 'CAD' } as AccountsOverview
const HEADERS = ['Date', 'Category', 'Amount', 'Payee']

// Two rows name a payee and two leave it blank, one of those blank by whitespace alone
const ROWS: CsvRow[] = [
  { Date: '2026-04-10', Category: 'Groceries', Amount: '-12.34', Payee: 'Corner Cafe' },
  { Date: '2026-04-11', Category: 'Groceries', Amount: '-8.00', Payee: '' },
  { Date: '2026-04-12', Category: 'Groceries', Amount: '-4.50', Payee: 'Corner Cafe' },
  { Date: '2026-04-13', Category: 'Groceries', Amount: '-9.99', Payee: '   ' },
]

/**
 * Creates a one-file import from the rows given
 */
function createFile(rows: CsvRow[]): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 512,
    headers: HEADERS,
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

/**
 * Builds a commit payload, optionally mapping the payee column
 */
function build({ payeeMapped = true }: { payeeMapped?: boolean } = {}) {
  return buildTransactionImportPayload({
    accountById: new Map([[ACCOUNT.id, ACCOUNT]]),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': ACCOUNT.id },
    accountSources: [{ id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false }],
    categoryById: new Map([[CATEGORY.id, CATEGORY]]),
    categoryCreateKinds: {},
    categoryMappings: { Groceries: CATEGORY.id },
    categoryTypesBySource: {},
    columnMap: {
      ...EMPTY_COLUMN_MAP,
      dt: 'Date',
      category_id: 'Category',
      amount: 'Amount',
      ...(payeeMapped ? { merchant_id: 'Payee' } : {}),
    },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    files: [createFile(ROWS)],
    importedCategories: ['Groceries'],
  })
}

/**
 * Builds the preview rows for one category kind, with no payee column mapped
 */
function preview(kind: Category['kind']) {
  const category = { ...CATEGORY, kind }

  return buildImportPreviewRows({
    files: [createFile(ROWS)],
    columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' },
    dateFormat: 'yearFirst',
    missingRequiredColumnLabels: [],
    currencies: CURRENCIES,
    accountById: new Map([[ACCOUNT.id, ACCOUNT]]),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    categoryById: new Map([[category.id, category]]),
    categoryCreateKinds: {},
    categoryTypesBySource: {},
    institutionById: new Map(),
    resolvedAccountMappings: { 'file-1': ACCOUNT.id },
    resolvedCategoryMappings: { Groceries: category.id },
    rowProblems: [],
  })
}

describe('counting the rows that state no payee', () => {
  it('counts every row where no column holds the payee', () => {
    expect(countRowsWithNoPayee([createFile(ROWS)], '')).toBe(4)
  })

  it('counts the blank cells where a column does, whitespace included', () => {
    expect(countRowsWithNoPayee([createFile(ROWS)], 'Payee')).toBe(2)
  })

  it('counts none where every row states one', () => {
    expect(countRowsWithNoPayee([createFile([ROWS[0], ROWS[2]])], 'Payee')).toBe(0)
  })
})

describe('importing a row that states no payee', () => {
  // Every transaction carries a merchant, so the row is brought in under one that ships with the
  // app rather than written without one and left uneditable
  it('sends the row with no payee of its own, for the API to fill in', () => {
    const result = build()

    expect(result.errors).toEqual([])
    expect(result.payload?.rows).toHaveLength(4)
    expect(result.payload?.rows.map((row) => row.merchant_name))
      .toEqual(['Corner Cafe', null, 'Corner Cafe', null])
  })

  it('imports a whole file that states no payee anywhere', () => {
    const result = build({ payeeMapped: false })

    expect(result.errors).toEqual([])
    expect(result.payload?.rows.every((row) => row.merchant_name === null)).toBe(true)
  })
})

describe('showing the merchant a row with no payee will carry', () => {
  it('shows the shared unknown merchant on an ordinary row', () => {
    expect(preview('expense')[0].transaction.merchant_name).toBe(UNKNOWN_MERCHANT_NAME)
  })

  // A transfer has no payee of its own, and the app puts this merchant on the transfers it writes
  // itself, so an imported one has to read the same way
  it('shows the shared self merchant on a transfer', () => {
    expect(preview('transfer')[0].transaction.merchant_name).toBe(SELF_MERCHANT_NAME)
  })
})

describe('what the mapping step says about those rows', () => {
  it('reads for one row without saying "1 rows"', () => {
    const message = getRowsWithNoPayeeExplanation(1)

    expect(message).toContain('1 row states no payee')
    expect(message).toContain('it will be filed under')
  })

  it('reads for several', () => {
    expect(getRowsWithNoPayeeExplanation(2)).toContain('2 rows state no payee')
  })
})

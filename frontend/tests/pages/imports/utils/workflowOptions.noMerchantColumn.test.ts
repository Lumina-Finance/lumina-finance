/**
 * Tests what the importer does with a row whose file states no merchant: it imports under one that
 * ships with the app, the preview shows which one, and the mapping step says how many rows
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  EMPTY_COLUMN_MAP,
  getRowsWithNoMerchantExplanation,
  SELF_MERCHANT_NAME,
  UNKNOWN_MERCHANT_NAME,
} from '@/pages/imports/constants'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import {
  buildImportPreviewRows,
  buildTransactionImportPayload,
  countRowsWithNoMerchant,
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

const ACCOUNT = { id: 'account-1', name: 'Chequing', currency: 'CAD', can_write: true } as AccountsOverview
const HEADERS = ['Date', 'Category', 'Amount', 'Payee']

// Two rows name a merchant and two leave it blank, one of those blank by whitespace alone
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
 * Builds a commit payload, optionally mapping the merchant column
 */
function build({ merchantMapped = true }: { merchantMapped?: boolean } = {}) {
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
      ...(merchantMapped ? { merchant_id: 'Payee' } : {}),
    },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    directionAnswers: {},
    files: [createFile(ROWS)],
    importedCategories: ['Groceries'],
  })
}

/**
 * Builds the preview rows for one category kind, with no merchant column mapped
 */
function preview(kind: Category['kind']) {
  const category = { ...CATEGORY, kind }

  return buildImportPreviewRows({
    files: [createFile(ROWS)],
    columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' },
    dateFormat: 'yearFirst',
    directionAnswers: {},
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

describe('counting the rows that state no merchant', () => {
  it('counts every row where no column holds the merchant', () => {
    expect(countRowsWithNoMerchant([createFile(ROWS)], '')).toBe(4)
  })

  it('counts the blank cells where a column does, whitespace included', () => {
    expect(countRowsWithNoMerchant([createFile(ROWS)], 'Payee')).toBe(2)
  })

  it('counts none where every row states one', () => {
    expect(countRowsWithNoMerchant([createFile([ROWS[0], ROWS[2]])], 'Payee')).toBe(0)
  })
})

describe('importing a row that states no merchant', () => {
  // Every transaction carries a merchant, so the row is brought in under one that ships with the
  // app rather than written without one and left uneditable
  it('sends the row with no merchant of its own, for the API to fill in', () => {
    const result = build()

    expect(result.errors).toEqual([])
    expect(result.payload?.rows).toHaveLength(4)
    expect(result.payload?.rows.map((row) => row.merchant_name))
      .toEqual(['Corner Cafe', null, 'Corner Cafe', null])
  })

  it('imports a whole file that states no merchant anywhere', () => {
    const result = build({ merchantMapped: false })

    expect(result.errors).toEqual([])
    expect(result.payload?.rows.every((row) => row.merchant_name === null)).toBe(true)
  })
})

describe('showing the merchant a row stating none will carry', () => {
  it('shows the shared unknown merchant on an ordinary row', () => {
    expect(preview('expense')[0].transaction.merchant_name).toBe(UNKNOWN_MERCHANT_NAME)
  })

  // A transfer has no merchant of its own, and the app puts this one on the transfers it writes
  // itself, so an imported one has to read the same way
  it('shows the shared self merchant on a transfer', () => {
    expect(preview('transfer')[0].transaction.merchant_name).toBe(SELF_MERCHANT_NAME)
  })
})

describe('what the mapping step says about those rows', () => {
  it('reads for one row without saying "1 rows"', () => {
    const message = getRowsWithNoMerchantExplanation(1, false)

    expect(message).toContain('1 row states no merchant')
    expect(message).toContain('it will be filed under')
  })

  it('reads for several', () => {
    expect(getRowsWithNoMerchantExplanation(2, false)).toContain('2 rows state no merchant')
  })

  it('offers the mapping advice only where no column is mapped', () => {
    expect(getRowsWithNoMerchantExplanation(2, false)).toContain('Map the column holding the merchant above')
  })

  // Telling someone to map a column they have already mapped sends them to a control that is
  // answered, and the rows are the ones whose cell was left blank rather than a missing column
  it('says the cells are blank where a column is mapped, and offers nothing to map', () => {
    const message = getRowsWithNoMerchantExplanation(2, true)

    expect(message).toContain('2 rows leave the merchant column blank')
    expect(message).not.toContain('Map the column')
  })
})

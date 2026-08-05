/**
 * Tests the choice the importer offers about rows stating no payee: bring them in under the shared
 * merchant, or leave them out, with the preview showing whichever was chosen
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  EMPTY_COLUMN_MAP,
  getEveryRowHasNoPayeeError,
  ROW_HAS_NO_PAYEE_REASON,
  SELF_MERCHANT_NAME,
  UNKNOWN_MERCHANT_NAME,
} from '@/pages/imports/constants'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import {
  buildImportPreviewRows,
  buildTransactionImportPayload,
  countRowsWithNoPayee,
  getImportedCategories,
  getImportingFiles,
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

// Two rows name a payee and two leave it blank, so a run that leaves the blanks out still has
// something to import and the counts are told apart
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
 * Builds a commit payload, optionally mapping the payee column and bringing payee-less rows in
 */
function build({
  payeeMapped = true,
  importRowsWithNoPayee = false,
  accountMapped = true,
  rows = ROWS,
}: {
  payeeMapped?: boolean
  importRowsWithNoPayee?: boolean
  accountMapped?: boolean
  rows?: CsvRow[]
} = {}) {
  return buildTransactionImportPayload({
    accountById: new Map([[ACCOUNT.id, ACCOUNT]]),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: accountMapped ? { 'file-1': ACCOUNT.id } : {},
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
    files: [createFile(rows)],
    importedCategories: ['Groceries'],
    importRowsWithNoPayee,
  })
}

/**
 * Builds the preview rows for one category kind, with no payee column mapped
 */
function preview(kind: Category['kind'], importRowsWithNoPayee: boolean) {
  const category = { ...CATEGORY, kind }
  const columnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' }
  const files = [createFile(ROWS)]
  const built = buildTransactionImportPayload({
    accountById: new Map([[ACCOUNT.id, ACCOUNT]]),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': ACCOUNT.id },
    accountSources: [{ id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false }],
    categoryById: new Map([[category.id, category]]),
    categoryCreateKinds: {},
    categoryMappings: { Groceries: category.id },
    categoryTypesBySource: {},
    columnMap,
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    files,
    importedCategories: ['Groceries'],
    importRowsWithNoPayee,
  })

  return buildImportPreviewRows({
    files,
    columnMap,
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
    rowProblems: built.rowProblems,
    rowExclusions: built.rowExclusions,
  })
}

describe('counting the rows that state no payee', () => {
  it('counts every row where no column holds the payee', () => {
    expect(countRowsWithNoPayee([createFile(ROWS)], '')).toBe(4)
  })

  it('counts the blank cells where a column does, whitespace included', () => {
    expect(countRowsWithNoPayee([createFile(ROWS)], 'Payee')).toBe(2)
  })

  it('counts none where every row names one', () => {
    expect(countRowsWithNoPayee([createFile([ROWS[0], ROWS[2]])], 'Payee')).toBe(0)
  })
})

describe('leaving rows with no payee out of the import', () => {
  it('imports only the rows that name a payee, and lists the rest', () => {
    const result = build()

    expect(result.payload?.rows).toHaveLength(2)
    expect(result.rowExclusions.map((row) => row.rowNumber)).toEqual([2, 4])
    expect(result.rowExclusions[0].reason).toBe(ROW_HAS_NO_PAYEE_REASON)
  })

  // Leaving them out is a choice rather than a fault, so it cannot stop an import of what remains
  it('does not stop the commit', () => {
    expect(build().payload).not.toBeNull()
    expect(build().errors).toEqual([])
  })

  // The list comes off the merchant column alone, so it holds while other questions are open and
  // the preview never shows a row that is on its way out
  it('lists them while a mapping question is still unanswered', () => {
    const result = build({ accountMapped: false })

    expect(result.payload).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.rowExclusions.map((row) => row.rowNumber)).toEqual([2, 4])
  })

  // Nothing about a row being left out is the user's to go and fix, so its own faults stay quiet
  it('reports a left-out row as left out rather than as one to fix', () => {
    const result = build({
      rows: [{ Date: '2026-04-10', Category: 'Groceries', Amount: 'abc', Payee: '' }],
    })

    expect(result.rowProblems).toEqual([])
    expect(result.rowExclusions.map((row) => row.reason)).toEqual([ROW_HAS_NO_PAYEE_REASON])
  })

  it('says so where that leaves nothing at all to import', () => {
    const result = build({ payeeMapped: false })

    expect(result.payload).toBeNull()
    expect(result.errors).toContain(getEveryRowHasNoPayeeError(4))
  })

  it('reads that message for one row without saying "1 rows"', () => {
    expect(getEveryRowHasNoPayeeError(1)).toContain('The only row states no payee and is being left out')
  })

  // The warning is about what the file says rather than about what this run brings in, so leaving
  // the outflows out must not make a file holding both signs read as one holding only income
  it('keeps the no-outflows warning off a file whose excluded rows are the outflows', () => {
    const result = build({
      rows: [
        { Date: '2026-04-10', Category: 'Groceries', Amount: '-50.00', Payee: '' },
        { Date: '2026-04-11', Category: 'Groceries', Amount: '2000.00', Payee: 'Employer' },
      ],
    })

    expect(result.rowExclusions).toHaveLength(1)
    expect(result.warnings).toEqual([])
  })
})

describe('keeping the left-out rows out of what the steps ask about', () => {
  // A category only a left-out row uses would otherwise be asked about in the matching step, and
  // answering it would create a category with no transactions in it
  it('leaves a category only a left-out row uses out of the values to match', () => {
    const rows: CsvRow[] = [
      { Date: '2026-04-10', Category: 'Groceries', Amount: '-12.34', Payee: 'Corner Cafe' },
      { Date: '2026-04-11', Category: 'Charity', Amount: '-50.00', Payee: '' },
    ]
    const importing = getImportingFiles([createFile(rows)], 'Payee', false)

    expect(getImportedCategories(importing, 'Category')).toEqual(['Groceries'])
  })

  it('asks about it again once those rows are being brought in', () => {
    const rows: CsvRow[] = [
      { Date: '2026-04-10', Category: 'Groceries', Amount: '-12.34', Payee: 'Corner Cafe' },
      { Date: '2026-04-11', Category: 'Charity', Amount: '-50.00', Payee: '' },
    ]
    const importing = getImportingFiles([createFile(rows)], 'Payee', true)

    expect(getImportedCategories(importing, 'Category')).toEqual(['Charity', 'Groceries'])
  })
})

describe('bringing rows with no payee in', () => {
  it('imports every row and lists none as left out', () => {
    const result = build({ importRowsWithNoPayee: true })

    expect(result.payload?.rows).toHaveLength(4)
    expect(result.rowExclusions).toEqual([])
  })

  it('imports a whole file that names no payee anywhere', () => {
    const result = build({ payeeMapped: false, importRowsWithNoPayee: true })

    expect(result.payload?.rows).toHaveLength(4)
    expect(result.errors).toEqual([])
  })
})

describe('showing what the choice does to the preview', () => {
  it('leaves the rows out of the sample where they are being left out', () => {
    expect(preview('expense', false)).toEqual([])
  })

  it('shows the shared unknown merchant on an ordinary row where they are brought in', () => {
    expect(preview('expense', true)[0].transaction.merchant_name).toBe(UNKNOWN_MERCHANT_NAME)
  })

  // A transfer has no payee of its own, and the app puts this merchant on the transfers it writes
  // itself, so an imported one has to read the same way
  it('shows the shared self merchant on a transfer', () => {
    expect(preview('transfer', true)[0].transaction.merchant_name).toBe(SELF_MERCHANT_NAME)
  })
})

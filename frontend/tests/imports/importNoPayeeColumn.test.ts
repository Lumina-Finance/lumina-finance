/**
 * Tests what the importer does about a payee: the question it asks when no column holds one, and
 * the merchant the preview shows for a row that states none
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  EMPTY_COLUMN_MAP,
  NO_MERCHANT_COLUMN_ERROR,
  SELF_MERCHANT_NAME,
  UNKNOWN_MERCHANT_NAME,
} from '@/pages/imports/constants'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import { buildImportPreviewRows, buildTransactionImportPayload } from '@/pages/imports/utils'

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

const ACCOUNT = {
  id: 'account-1',
  name: 'Chequing',
  currency: 'CAD',
} as AccountsOverview

const HEADERS = ['Date', 'Category', 'Amount', 'Payee']

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

const ROWS: CsvRow[] = [{ Date: '2026-04-10', Category: 'Groceries', Amount: '-12.34', Payee: '' }]

/**
 * Builds a commit payload, optionally mapping the payee column and answering the question
 */
function build({
  payeeMapped = false,
  noPayeeColumnConfirmed = false,
}: { payeeMapped?: boolean; noPayeeColumnConfirmed?: boolean } = {}) {
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
    noPayeeColumnConfirmed,
  })
}

/**
 * Builds a payload for a file whose one row carries a date the chosen format cannot read
 */
function buildWithUnreadableDate() {
  const rows: CsvRow[] = [{ Date: 'not a date', Category: 'Groceries', Amount: '-12.34', Payee: '' }]

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
    columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    files: [createFile(rows)],
    importedCategories: ['Groceries'],
    noPayeeColumnConfirmed: false,
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

describe('asking what a file with no payee column should do', () => {
  // Every transaction carries a merchant, so a file with no payee column files every row under one
  // shared merchant. That is worth answering for rather than discovering afterwards
  it('refuses to build a payload until the question is answered', () => {
    const result = build()

    expect(result.payload).toBeNull()
    expect(result.errors).toContain(NO_MERCHANT_COLUMN_ERROR)
  })

  it('builds the payload once the answer is given', () => {
    const result = build({ noPayeeColumnConfirmed: true })

    expect(result.payload?.rows).toHaveLength(1)
    expect(result.errors).not.toContain(NO_MERCHANT_COLUMN_ERROR)
  })

  it('does not ask where a column holds the payee', () => {
    const result = build({ payeeMapped: true })

    expect(result.payload?.rows).toHaveLength(1)
    expect(result.errors).not.toContain(NO_MERCHANT_COLUMN_ERROR)
  })

  // No row's verdict depends on this answer, so the rows a user has to go and fix are still listed
  // while it is outstanding, rather than appearing only once the box is ticked
  it('still lists the rows that cannot be converted while the question is open', () => {
    const result = buildWithUnreadableDate()

    expect(result.errors).toContain(NO_MERCHANT_COLUMN_ERROR)
    expect(result.rowProblems).toHaveLength(1)
    expect(result.rowProblems[0].rowNumber).toBe(1)
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

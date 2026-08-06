/**
 * Tests the two things the importer says about amounts that do not stop the commit: a file whose
 * rows all read as money coming in, and a row filed against the direction its category runs in
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  EMPTY_COLUMN_MAP,
  NO_OUTFLOWS_WARNING,
  ROW_SIGN_DISAGREES_WITH_CATEGORY_REASON,
} from '@/pages/imports/constants'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
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

const HEADERS = ['Date', 'Category', 'Amount']

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
 * Builds a commit payload for the amounts given, all filed under one category of the given kind
 */
function build(amounts: string[], kind: Category['kind'] = 'expense') {
  const category = { ...CATEGORY, kind }

  return buildTransactionImportPayload({
    accountById: new Map(),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': 'account-1' },
    accountSources: [{ id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false }],
    categoryById: new Map([[category.id, category]]),
    categoryCreateKinds: {},
    categoryMappings: { Groceries: category.id },
    categoryTypesBySource: {},
    columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' },
    columnValidationErrors: {},
    currencies: CURRENCIES,
    dateFormat: 'yearFirst',
    files: [createFile(amounts.map((amount, index) => ({
      Date: `2026-04-${String(index + 1).padStart(2, '0')}`,
      Category: 'Groceries',
      Amount: amount,
    })))],
    importedCategories: ['Groceries'],
  })
}

describe('warning that a file reads as all money coming in', () => {
  // The sign is the only direction the importer reads, so a file written without one imports every
  // expense as income. It is a warning rather than a refusal, since a file of pure income is real
  it('warns where no row is negative, without stopping the commit', () => {
    const result = build(['12.34', '45.00'])

    expect(result.warnings).toContain(NO_OUTFLOWS_WARNING)
    expect(result.payload).not.toBeNull()
  })

  it('says nothing where the file carries a negative', () => {
    expect(build(['-12.34', '45.00']).warnings).toEqual([])
  })
})

describe('warning about a row filed against its category\'s direction', () => {
  // Cash flow reads the sign while the category total reads the kind, so this row is counted as an
  // inflow and as a reduction in Groceries spend at the same time
  it('lists a refund inside an expense category without stopping the commit', () => {
    const result = build(['-12.34', '45.00'])

    expect(result.payload?.rows).toHaveLength(2)
    expect(result.rowWarnings).toHaveLength(1)
    expect(result.rowWarnings[0].rowNumber).toBe(2)
    expect(result.rowWarnings[0].reason).toBe(ROW_SIGN_DISAGREES_WITH_CATEGORY_REASON)
  })

  it('lists a negative row inside an income category', () => {
    const result = build(['2400.00', '-50.00'], 'income')

    expect(result.rowWarnings).toHaveLength(1)
    expect(result.rowWarnings[0].rowNumber).toBe(2)
  })

  it('says nothing where every row runs the way its category does', () => {
    expect(build(['-12.34', '-8.00']).rowWarnings).toEqual([])
    expect(build(['2400.00'], 'income').rowWarnings).toEqual([])
  })

  it('says nothing about a transfer, which has no direction rule anywhere', () => {
    expect(build(['-500.00', '500.00'], 'transfer').rowWarnings).toEqual([])
  })

  it('says nothing about an amount of zero, which has no direction', () => {
    expect(build(['0.00']).rowWarnings).toEqual([])
  })
})

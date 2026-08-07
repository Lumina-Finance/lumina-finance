/**
 * Tests how the import commit payload reads its date column, covering the row values it sends and
 * the refusal to build anything at all until a date format has been settled
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  DEFAULT_AMOUNT_SIGN_CONVENTIONS,
  EMPTY_COLUMN_MAP,
  ROW_DATE_BLANK_REASON,
  ROW_DATE_UNREADABLE_REASON,
} from '@/pages/imports/constants'
import type { ColumnMap, ImportFileDraft } from '@/pages/imports/types'
import { buildTransactionImportPayload } from '@/pages/imports/utils'
import type { ImportDateFormat } from '@/pages/imports/utils/valueParsers'

// The account these rows are written to has no currency of its own in this file's fixtures, so the
// list only has to hold whatever the amount checks would read
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

const COLUMN_MAP: ColumnMap = {
  ...EMPTY_COLUMN_MAP,
  dt: 'Date',
  amount: 'Amount',
  category_id: 'Category',
}

/**
 * Creates a single-file import whose rows carry the given date strings
 */
function createFile(dates: string[]): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Checking.csv',
    size: 512,
    headers: ['Date', 'Amount', 'Category'],
    hasHeaderRow: true,
    rows: dates.map((date) => ({ Date: date, Amount: '-12.34', Category: 'Groceries' })),
    error: null,
  }
}

/**
 * Builds a payload for one file, with every mapping other than the date format already settled
 */
function build(dates: string[], dateFormat: ImportDateFormat | null, columnValidationErrors: Record<string, string> = {}) {
  return buildTransactionImportPayload({
    accountById: new Map(),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': 'account-1' },
    currencies: CURRENCIES,
    accountSources: [{ id: 'file-1', label: 'Checking.csv', matchText: 'Checking.csv', isCounterpartyOnly: false }],
    categoryById: new Map([[CATEGORY.id, CATEGORY]]),
    categoryCreateKinds: {},
    categoryMappings: { Groceries: CATEGORY.id },
    categoryTypesBySource: {},
    columnMap: COLUMN_MAP,
    columnValidationErrors,
    amountSignConventions: DEFAULT_AMOUNT_SIGN_CONVENTIONS,
    dateFormat,
    files: [createFile(dates)],
    importedCategories: ['Groceries'],
  })
}

describe('import payload dates', () => {
  it('sends the day the chosen format names', () => {
    expect(build(['15/03/2024'], 'dayFirst').payload?.rows[0].dt).toBe('2024-03-15')
  })

  it('reads the same value as a different day under the other order', () => {
    expect(build(['03/04/2024'], 'dayFirst').payload?.rows[0].dt).toBe('2024-04-03')
    expect(build(['03/04/2024'], 'monthFirst').payload?.rows[0].dt).toBe('2024-03-04')
  })

  it('refuses to build until a date format is chosen, saying so rather than blaming the rows', () => {
    const result = build(['03/04/2024'], null)

    expect(result.payload).toBeNull()
    expect(result.errors).toContain('Choose the date format this file is written in.')

    // Not one entry per row saying its date does not fit a format nobody has chosen yet
    expect(result.rowProblems).toEqual([])
  })

  it('refuses a row the chosen format cannot read, listing which row it is', () => {
    const result = build(['15/03/2024', '2024-03-16'], 'dayFirst')

    expect(result.payload).toBeNull()
    expect(result.rowProblems.map((problem) => ({ rowNumber: problem.rowNumber, reason: problem.reason }))).toEqual([
      { rowNumber: 2, reason: ROW_DATE_UNREADABLE_REASON },
    ])
  })

  it('lists the rows behind a column the values do not fit, alongside the column error', () => {
    const columnError = 'Expected valid dates in the day-first format, such as 15/03/2024; every row must have a value. "2024-03-16" is not a valid date.'
    const result = build(['15/03/2024', '2024-03-16'], 'dayFirst', { Date: columnError })

    // A column whose values do not fit is a statement about rows, so it reports the column and the
    // rows behind it, unlike a mapping question nobody has answered yet
    expect(result.errors).toEqual([columnError])
    expect(result.rowProblems.map((problem) => problem.rowNumber)).toEqual([2])
  })

  it('tells a blank cell apart from one the chosen format cannot read', () => {
    expect(build(['15/03/2024', ''], 'dayFirst').rowProblems.map((problem) => problem.reason))
      .toEqual([ROW_DATE_BLANK_REASON])
  })

  it('refuses a day the calendar does not have, whatever format states it', () => {
    expect(build(['31/02/2024'], 'dayFirst').payload).toBeNull()
    expect(build(['2024-02-31'], 'yearFirst').payload).toBeNull()
  })
})

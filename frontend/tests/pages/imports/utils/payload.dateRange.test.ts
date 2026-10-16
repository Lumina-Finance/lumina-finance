/**
 * Tests the dates a CSV import can be limited to: the commit payload sends only the rows dated inside
 * them, both ends included, without listing the rest as problems, and refuses a range that holds no
 * rows or whose ends are crossed instead of importing the whole file
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  EMPTY_COLUMN_MAP,
  getImportNoRowsError,
  IMPORT_DATE_RANGE_CROSSED_ERROR,
  IMPORT_DATE_RANGE_INCOMPLETE_ERROR,
  IMPORT_NO_ROWS_IN_DATE_RANGE_ERROR,
  MAX_IMPORT_MAPPINGS,
  ROW_AMOUNT_UNREADABLE_REASON,
  ROW_DATE_UNREADABLE_REASON,
} from '@/pages/imports/constants'
import type { ColumnMap, CsvRow, ImportAmountDirection, ImportDateRange, ImportFileDraft } from '@/pages/imports/types'
import { buildTransactionImportPayload, getImportDateRangeFilter, getImportedCategories } from '@/pages/imports/utils'
import type { ImportDateFormat } from '@/pages/imports/utils/valueParsers'

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

const COLUMN_MAP: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount', category_id: 'Category' }

// One row on the last day of each month of 2025, then the first of each month, so each end of a
// month-long range has a row on it and a row just past it
const YEAR_OF_DATES = Array.from({ length: 12 }, (_, month) => [
  `2025-${String(month + 1).padStart(2, '0')}-01`,
  new Date(Date.UTC(2025, month + 1, 0)).toISOString().slice(0, 10),
]).flat()

function createFile(rows: CsvRow[], headers = ['Date', 'Amount', 'Category']): ImportFileDraft {
  return { id: 'file-1', name: 'Checking.csv', size: 512, headers, hasHeaderRow: true, rows, error: null }
}

function rowsOn(dates: string[], amount = '-12.34'): CsvRow[] {
  return dates.map((date) => ({ Date: date, Amount: amount, Category: 'Groceries' }))
}

/**
 * Builds the payload for one file, with every answer other than the range already settled
 */
function build(
  rows: CsvRow[],
  dateRange: ImportDateRange,
  {
    dateFormat = 'yearFirst',
    timeZone,
    columnMap = COLUMN_MAP,
    headers,
    directionAnswers = {},
    importedCategories = ['Groceries'],
  }: {
    dateFormat?: ImportDateFormat
    timeZone?: string
    columnMap?: ColumnMap
    headers?: string[]
    directionAnswers?: Record<string, ImportAmountDirection>
    importedCategories?: string[]
  } = {},
) {
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
    columnMap,
    columnValidationErrors: {},
    dateFormat,
    timeZone,
    dateRange,
    directionAnswers,
    files: [createFile(rows, headers)],
    importedCategories,
  })
}

describe('importing a chosen range of dates', () => {
  it('sends only the rows from the start date to the end date, both included', () => {
    const result = build(rowsOn(YEAR_OF_DATES), { from: '2025-03-01', to: '2025-03-31' })

    expect(result.errors).toEqual([])
    expect(result.payload?.rows.map((row) => row.dt)).toEqual(['2025-03-01', '2025-03-31'])
    expect(result.rowProblems).toEqual([])
  })

  it('sends every row from the start date to the end of the file when only a start date is chosen', () => {
    const result = build(rowsOn(YEAR_OF_DATES), { from: '2025-06-01', to: '' })

    expect(result.payload?.rows.map((row) => row.dt)).toEqual(YEAR_OF_DATES.filter((date) => date >= '2025-06-01'))
  })

  it('sends every row from the start of the file to the end date when only an end date is chosen', () => {
    const result = build(rowsOn(YEAR_OF_DATES), { from: '', to: '2025-01-31' })

    expect(result.payload?.rows.map((row) => row.dt)).toEqual(['2025-01-01', '2025-01-31'])
  })

  it('still lists a row whose date can\'t be read, whatever the range, by its place in the whole file', () => {
    const result = build(rowsOn(['2025-01-15', 'not a date', '2025-03-15']), { from: '2025-03-01', to: '2025-03-31' })

    expect(result.payload?.rows.map((row) => row.dt)).toEqual(['2025-03-15'])
    expect(result.rowProblems.map(({ id, rowNumber, reason }) => ({ id, rowNumber, reason })))
      .toEqual([{ id: 'file-1-1', rowNumber: 2, reason: ROW_DATE_UNREADABLE_REASON }])
  })

  it('leaves out a row outside the range without judging anything else about it', () => {
    const rows = [...rowsOn(['2025-01-15'], 'forty'), ...rowsOn(['2025-03-15'])]
    const result = build(rows, { from: '2025-03-01', to: '' })

    // Read whole, the bad amount is a problem row, so the range is what leaves it out unlisted
    expect(build(rows, { from: '', to: '' }).rowProblems.map((problem) => problem.reason)).toEqual([ROW_AMOUNT_UNREADABLE_REASON])
    expect(result.rowProblems).toEqual([])
    expect(result.payload?.rows.map((row) => row.dt)).toEqual(['2025-03-15'])
  })

  // The row is saved under its day in the profile timezone, so that is the day the range reads
  it('keeps or leaves out a timestamp near midnight by its day in the profile timezone', () => {
    const rows = rowsOn(['2025-03-31T23:30:00-04:00'])
    const march = { from: '2025-03-01', to: '2025-03-31' }

    expect(build(rows, march, { dateFormat: 'iso', timeZone: 'America/Toronto' }).payload?.rows.map((row) => row.dt))
      .toEqual(['2025-03-31'])
    expect(build(rows, march, { dateFormat: 'iso', timeZone: 'UTC' }).errors).toEqual([IMPORT_NO_ROWS_IN_DATE_RANGE_ERROR])
  })

  it('says no rows fall within the chosen dates, rather than that the file has none, and offers nothing to import', () => {
    const result = build(rowsOn(YEAR_OF_DATES), { from: '2026-01-01', to: '2026-12-31' })

    expect(result.payload).toBeNull()
    expect(result.errors).toEqual([IMPORT_NO_ROWS_IN_DATE_RANGE_ERROR])
  })

  // The file does hold rows, so saying it has none would be wrong, while the refused row is still listed
  it('says no rows fall within the chosen dates where the only row inside them is refused', () => {
    const result = build(rowsOn(['2025-01-15', 'not a date']), { from: '2025-03-01', to: '' })

    expect(result.errors).toEqual([IMPORT_NO_ROWS_IN_DATE_RANGE_ERROR])
    expect(result.rowProblems.map((problem) => problem.reason)).toEqual([ROW_DATE_UNREADABLE_REASON])
  })

  it('keeps saying the file has no rows to import where it has none at all', () => {
    expect(build([], { from: '2025-03-01', to: '' }).errors).toEqual([getImportNoRowsError('file')])
  })

  // Reading a partly typed date as no limit would write every row past the date the user meant
  it('refuses a partly typed date with that reason alone, rather than importing the whole file', () => {
    const result = build(rowsOn(YEAR_OF_DATES), { from: null, to: '2025-03-31' })

    expect(result.payload).toBeNull()
    expect(result.errors).toEqual([IMPORT_DATE_RANGE_INCOMPLETE_ERROR])
  })

  it('refuses crossed dates with that reason alone, rather than importing the whole file or saying it is empty', () => {
    const result = build(rowsOn(YEAR_OF_DATES), { from: '2025-04-01', to: '2025-03-31' })

    expect(result.payload).toBeNull()
    expect(result.errors).toEqual([IMPORT_DATE_RANGE_CROSSED_ERROR])
  })

  // The limit is on what one import carries, and rows outside the dates aren't carried
  it('leaves the categories only rows outside the dates name out of the limit on new mappings', () => {
    const rows = [
      ...Array.from({ length: MAX_IMPORT_MAPPINGS + 1 }, (_, index) => ({ Date: '2025-01-15', Amount: '-1.00', Category: `Old ${index}` })),
      ...rowsOn(['2025-03-15']),
    ]
    const march = { from: '2025-03-01', to: '2025-03-31' }
    const isRowIncluded = getImportDateRangeFilter({ columnMap: COLUMN_MAP, dateFormat: 'yearFirst', dateRange: march })!
    const files = [createFile(rows)]

    expect(getImportedCategories(files, COLUMN_MAP, {})).toHaveLength(MAX_IMPORT_MAPPINGS + 2)
    const result = build(rows, march, { importedCategories: getImportedCategories(files, COLUMN_MAP, {}, undefined, isRowIncluded) })
    expect(result.errors).toEqual([])
    expect(result.payload?.rows).toHaveLength(1)
  })

  it('asks only about the Direction words the rows inside the dates use', () => {
    const columnMap = { ...COLUMN_MAP, amount_direction: 'Type' }
    const rows = [
      { Date: '2025-01-15', Amount: '12.34', Category: 'Groceries', Type: 'refund' },
      { Date: '2025-03-15', Amount: '12.34', Category: 'Groceries', Type: 'debit' },
    ]
    const options = { columnMap, headers: ['Date', 'Amount', 'Category', 'Type'], directionAnswers: { debit: 'out' as const } }

    expect(build(rows, { from: '', to: '' }, options).payload).toBeNull()
    expect(build(rows, { from: '2025-03-01', to: '' }, options).payload?.rows.map((row) => row.amount)).toEqual(['-12.34'])
  })
})

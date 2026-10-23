/**
 * Tests the chosen dates' own bookkeeping: a date still being typed leaves the range as it was, so an
 * upload kept from an interrupted save is not taken for one sent with other answers, and the rows the
 * range leaves out are unknown rather than none while it cannot be applied
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP, getRowsOutsideDateRangeExplanation } from '@/pages/imports/constants'
import type { ImportDateRange, ImportFileDraft } from '@/pages/imports/types'
import {
  countImportRowsOutsideDateRange,
  getImportDateRangeFilter,
  getLatestStartSuggestion,
  getLatestTransactionFilters,
  getNextImportDateRange,
  isImportDateRangeIncomplete,
  WHOLE_FILE_DATE_RANGE,
} from '@/pages/imports/utils'

const COLUMN_MAP = { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount' }

const FILE: ImportFileDraft = {
  id: 'file-1',
  name: 'Checking.csv',
  size: 512,
  headers: ['Date', 'Amount'],
  hasHeaderRow: true,
  rows: ['2025-01-15', '2025-03-15', '2025-05-15'].map((Date) => ({ Date, Amount: '-1.00' })),
  error: null,
}

function countOutside(dateRange: ImportDateRange, dateFormat: 'yearFirst' | null = 'yearFirst') {
  return countImportRowsOutsideDateRange([FILE], getImportDateRangeFilter({ columnMap: COLUMN_MAP, dateFormat, dateRange }))
}

describe('changing the chosen dates', () => {
  it('makes a new range when an end changes', () => {
    const next = getNextImportDateRange(WHOLE_FILE_DATE_RANGE, 'from', '2025-03-01', false)

    expect(next).not.toBe(WHOLE_FILE_DATE_RANGE)
    expect(next).toEqual({ from: '2025-03-01', to: '' })
  })

  // The date field reports a partly typed end on every keystroke until the date is whole
  it('keeps the same range while a date is still being typed', () => {
    const range = { from: null, to: '2025-03-31' }

    expect(getNextImportDateRange(range, 'from', '', true)).toBe(range)
  })

  // Typing one digit into an empty field must not read as no limit, which would import every row
  it('tells a date begun from a date cleared', () => {
    const begun = getNextImportDateRange(WHOLE_FILE_DATE_RANGE, 'from', '', true)

    expect(isImportDateRangeIncomplete(COLUMN_MAP, begun)).toBe(true)
    expect(isImportDateRangeIncomplete(COLUMN_MAP, getNextImportDateRange(begun, 'from', '', false))).toBe(false)
  })

  // Deleting the day of a date already entered must not read as no limit either
  it('counts a whole date edited back to a partly typed one as a change that blocks the import', () => {
    const march = { from: '2025-03-01', to: '2025-03-31' }
    const edited = getNextImportDateRange(march, 'to', '', true)

    expect(edited).not.toBe(march)
    expect(isImportDateRangeIncomplete(COLUMN_MAP, edited)).toBe(true)
  })
})

describe('counting the rows outside the chosen dates', () => {
  it('counts the rows dated outside the range', () => {
    expect(countOutside({ from: '2025-03-01', to: '2025-03-31' })).toBe(2)
  })

  it('counts none with no range chosen, even before the date format is settled', () => {
    expect(countOutside(WHOLE_FILE_DATE_RANGE, null)).toBe(0)
  })

  it('leaves the count unknown while the date format is not settled', () => {
    expect(countOutside({ from: '2025-03-01', to: '' }, null)).toBeNull()
  })

  it('leaves the count unknown while the ends are crossed', () => {
    expect(countOutside({ from: '2025-04-01', to: '2025-03-01' })).toBeNull()
  })

  it('leaves the count unknown while a date is only partly typed', () => {
    expect(countOutside({ from: '2025-03-01', to: null })).toBeNull()
  })
})

describe('offering the day after the latest transaction as the start', () => {
  it('looks for the newest transaction up to today, in the account or in every account on an ordinary import', () => {
    // A future-dated transaction would start the import after rows already past
    const latest = { sort_by: 'dt', sort_order: 'desc', limit: 1, to_date: '2026-10-23' }
    expect(getLatestTransactionFilters('acc-1', '2026-10-23')).toEqual({ account_id: ['acc-1'], ...latest })
    expect(getLatestTransactionFilters(null, '2026-10-23')).toEqual(latest)
  })

  it('starts the day after the latest transaction, across a month and year end', () => {
    expect(getLatestStartSuggestion('2025-12-31')).toBe('2026-01-01')
    expect(getLatestStartSuggestion('2025-06-15')).toBe('2025-06-16')
  })

  it('offers nothing without a latest transaction', () => {
    expect(getLatestStartSuggestion(undefined)).toBeNull()
    expect(getLatestStartSuggestion(null)).toBeNull()
  })
})

describe('explaining the rows outside the chosen dates', () => {
  it('speaks of one row in the singular', () => {
    expect(getRowsOutsideDateRangeExplanation(1, false)).toBe('1 row is dated outside the chosen dates, so it won\'t be imported.')
    expect(getRowsOutsideDateRangeExplanation(1, true)).toBe('1 row was dated outside the chosen dates, so it wasn\'t imported.')
  })

  it('speaks of several rows in the plural', () => {
    expect(getRowsOutsideDateRangeExplanation(2, false)).toBe('2 rows are dated outside the chosen dates, so they won\'t be imported.')
    expect(getRowsOutsideDateRangeExplanation(2, true)).toBe('2 rows were dated outside the chosen dates, so they weren\'t imported.')
  })
})

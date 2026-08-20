/**
 * Tests what validateColumnMap keeps and drops when the uploaded files change: which mappings
 * survive against the headers actually present, and which validation error lands against which
 * header when two targets are mapped to the same column
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ColumnMap, CsvRow, ImportFileDraft } from '@/pages/imports/types'
import { validateColumnMap } from '@/pages/imports/utils'

const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD'])

/**
 * Creates a one-file draft from the given headers and rows
 */
function createFile(headers: string[], rows: CsvRow[]): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 1024,
    headers,
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

describe('pairing a failing column with its error', () => {
  it('keeps a failing mapping in the map, flagged beside it', () => {
    const map: ColumnMap = { ...EMPTY_COLUMN_MAP, category_id: 'Amount' }
    const files = [createFile(['Amount'], [
      { Amount: '-12.34' },
      { Amount: '-8.00' },
      { Amount: '45.00' },
    ])]

    const result = validateColumnMap(map, files, SUPPORTED_CURRENCY_CODES)

    expect(result.map.category_id).toBe('Amount')
    expect(result.errors.Amount).toBeTruthy()
  })
})

describe('dropping a mapping whose header the files no longer carry', () => {
  it('clears the mapping quietly, without an error', () => {
    const map: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Missing' }
    const files = [createFile(['Date', 'Amount'], [])]

    const result = validateColumnMap(map, files, SUPPORTED_CURRENCY_CODES)

    expect(result.map.dt).toBe('')
    expect(result.errors).toEqual({})
  })
})

describe('no files staged', () => {
  // A caller mutating the result would corrupt the shared constant every other empty state reads
  it('returns the shared empty map by reference', () => {
    const map: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date' }

    const result = validateColumnMap(map, [], SUPPORTED_CURRENCY_CODES)

    expect(result.map).toBe(EMPTY_COLUMN_MAP)
  })
})

describe('mappings spread across several files', () => {
  it('keeps both, reading the header union rather than either file alone', () => {
    const map: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount' }
    const files = [
      createFile(['Date'], [{ Date: '2026-01-01' }]),
      createFile(['Amount'], [{ Amount: '12.34' }]),
    ]

    const result = validateColumnMap(map, files, SUPPORTED_CURRENCY_CODES)

    expect(result.map.dt).toBe('Date')
    expect(result.map.amount).toBe('Amount')
  })
})

describe('one header mapped to two targets', () => {
  // Amount runs before Currency in COLUMN_TARGETS, so this is the case that fails if the loop
  // stops overwriting the earlier target's entry with the later one's
  it('keeps only the later target\'s message', () => {
    const map: ColumnMap = { ...EMPTY_COLUMN_MAP, amount: 'SameCol', currency: 'SameCol' }
    const files = [createFile(['SameCol'], [{ SameCol: '-12.34' }])]

    const result = validateColumnMap(map, files, SUPPORTED_CURRENCY_CODES)

    expect(Object.keys(result.errors)).toEqual(['SameCol'])
    expect(result.errors.SameCol).toBe(
      'Expected ISO currency codes this app supports, such as CAD or USD. Row 1 has "-12.34", which does not match.',
    )
  })
})

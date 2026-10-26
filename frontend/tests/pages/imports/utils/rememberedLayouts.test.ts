/**
 * Tests turning a staged file and its answers into the layout an import saves, and a saved layout back
 * into settings the page applies, so a file is never remembered wrongly or opened with a setting the
 * page doesn't offer
 */
import { describe, expect, it } from 'vitest'
import type { SavedCsvImportLayout } from '@/api/transaction-imports'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import {
  buildCsvImportLayout,
  MAX_IMPORT_ROWS,
  readSavedImportLayouts,
} from '@/pages/imports/utils'

const STAGED: ImportFileDraft = {
  id: 'file-1',
  name: 'web.csv',
  size: 120,
  headers: ['Account', 'Date', 'Description', 'Amount', 'Memo'],
  hasHeaderRow: true,
  rows: [],
  error: null,
  delimiter: ';',
  reading: { headerRow: 2, skipLastRows: 1, isSkipLastRowsDetected: false, preview: [] },
}

const COLUMN_MAP = { ...EMPTY_COLUMN_MAP, account_id: 'Account', dt: 'Date', merchant_id: 'Description', amount: 'Amount' }

const SAVED: SavedCsvImportLayout = {
  account_id: 'checking',
  headers: ['Date', 'Description', 'Amount'],
  delimiter: ';',
  header_row: 2,
  column_map: { dt: 'Date', merchant_id: 'Description', amount: 'Amount' },
  date_format: 'dayFirst',
  amount_format: { decimal_separator: ',', grouping_separator: 'space' },
}

describe('the layout an import saves', () => {
  // The staged file had its last line skipped, which is not kept: a footer's length can change
  it('holds how the file was read and every mapped field except the account', () => {
    expect(buildCsvImportLayout(STAGED, COLUMN_MAP, 'dayFirst', { decimalSeparator: ',', groupingSeparator: 'space' })).toEqual({
      headers: STAGED.headers,
      delimiter: ';',
      header_row: 2,
      column_map: { dt: 'Date', merchant_id: 'Description', amount: 'Amount' },
      date_format: 'dayFirst',
      amount_format: { decimal_separator: ',', grouping_separator: 'space' },
    })
  })

  it('is left out for a file read without a header row', () => {
    const headerless = { ...STAGED, hasHeaderRow: false, reading: { headerRow: null, skipLastRows: 0, isSkipLastRowsDetected: false, preview: [] } }

    expect(buildCsvImportLayout(headerless, COLUMN_MAP, 'dayFirst', { decimalSeparator: '.', groupingSeparator: ',' })).toBeNull()
  })

  it('is left out for a header longer than the server keeps, rather than refusing the import', () => {
    const longHeader = { ...STAGED, headers: [...STAGED.headers, 'x'.repeat(257)] }

    expect(buildCsvImportLayout(longHeader, COLUMN_MAP, 'dayFirst', { decimalSeparator: '.', groupingSeparator: ',' })).toBeNull()
  })

  it.each([
    ['more columns than the server keeps', { headers: [...STAGED.headers, ...Array.from({ length: 252 }, (_, n) => `Extra ${n}`)] }],
    ['a header row past the last line the server keeps', { reading: { headerRow: MAX_IMPORT_ROWS + 1, skipLastRows: 0, isSkipLastRowsDetected: false, preview: [] } }],
  ])('is left out for a file with %s, rather than refusing the import', (_case, change) => {
    const file = { ...STAGED, ...change }

    expect(buildCsvImportLayout(file, COLUMN_MAP, 'dayFirst', { decimalSeparator: '.', groupingSeparator: ',' })).toBeNull()
  })

  it.each([
    ['as many columns as the server keeps', { headers: Array.from({ length: 256 }, (_, n) => `Column ${n}`) }],
    ['a header as long as the server keeps', { headers: ['Date', 'x'.repeat(256)] }],
    ['a header row on the last line the server keeps', { reading: { headerRow: MAX_IMPORT_ROWS, skipLastRows: 0, isSkipLastRowsDetected: false, preview: [] } }],
  ])('is kept for a file with %s', (_case, change) => {
    const file = { ...STAGED, ...change }

    expect(buildCsvImportLayout(file, COLUMN_MAP, 'dayFirst', { decimalSeparator: '.', groupingSeparator: ',' })).not.toBeNull()
  })
})

describe('a saved layout read back', () => {
  it('becomes the page’s own settings', () => {
    expect(readSavedImportLayouts([SAVED])).toEqual([{
      accountId: 'checking',
      headers: SAVED.headers,
      delimiter: ';',
      headerRow: 2,
      settings: {
        columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', merchant_id: 'Description', amount: 'Amount' },
        dateFormat: 'dayFirst',
        amountFormat: { decimalSeparator: ',', groupingSeparator: 'space' },
      },
    }])
  })

  it.each([
    ['a date format', { date_format: 'julian' }],
    ['an amount format', { amount_format: { decimal_separator: ',', grouping_separator: ',' } }],
    ['a field', { column_map: { dt: 'Date', balance: 'Amount' } }],
    ['the account field', { column_map: { dt: 'Date', account_id: 'Amount' } }],
  ])('is left out when it names %s the page doesn’t offer', (_case, change) => {
    expect(readSavedImportLayouts([{ ...SAVED, ...change }])).toEqual([])
  })

  it('is left out when its separator is one the page can’t read with', () => {
    expect(readSavedImportLayouts([{ ...SAVED, delimiter: '|' }])).toEqual([])
  })
})

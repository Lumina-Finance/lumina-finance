/**
 * Tests that the mapping step asks only about the rows the chosen dates keep: a value only rows
 * outside them carry raises no question, since answering it would change nothing the import writes
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft, ImportRowFilter } from '@/pages/imports/types'
import {
  buildImportAccountMappingSources,
  countRowsWithNoMerchant,
  getImportDateRangeFilter,
  getImportedMerchants,
  getImportedTags,
  getStatedCurrencyByAccountSource,
  includeEveryImportRow,
} from '@/pages/imports/utils'

const HEADERS = ['Date', 'Amount', 'Account', 'Currency', 'Merchant', 'Tags']

// Both January rows fall outside a March range, and each carries a value no March row does
const FILES: ImportFileDraft[] = [{
  id: 'file-1',
  name: 'Checking.csv',
  size: 512,
  headers: HEADERS,
  hasHeaderRow: true,
  rows: [
    { Date: '2025-01-10', Amount: '-5.00', Account: 'Old card', Currency: 'USD', Merchant: 'Airline', Tags: 'trip' },
    { Date: '2025-01-20', Amount: '-5.00', Account: 'Old card', Currency: 'USD', Merchant: '', Tags: '' },
    { Date: '2025-03-15', Amount: '-5.00', Account: 'Chequing', Currency: 'CAD', Merchant: 'Market', Tags: 'food' },
  ],
  error: null,
}]

const MARCH = getImportDateRangeFilter({
  columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date' },
  dateFormat: 'yearFirst',
  dateRange: { from: '2025-03-01', to: '2025-03-31' },
})!

const READERS: { name: string; read: (isRowIncluded: ImportRowFilter) => unknown; wholeFile: unknown; inRange: unknown }[] = [
  {
    name: 'the rows stating no merchant',
    read: (isRowIncluded) => countRowsWithNoMerchant(FILES, 'Merchant', isRowIncluded),
    wholeFile: 1,
    inRange: 0,
  },
  {
    name: 'the merchants',
    read: (isRowIncluded) => getImportedMerchants(FILES, 'Merchant', isRowIncluded),
    wholeFile: ['Airline', 'Market'],
    inRange: ['Market'],
  },
  {
    name: 'the tags',
    read: (isRowIncluded) => getImportedTags(FILES, 'Tags', isRowIncluded),
    wholeFile: ['food', 'trip'],
    inRange: ['food'],
  },
  {
    name: 'the accounts',
    read: (isRowIncluded) => buildImportAccountMappingSources(FILES, 'Account', '', isRowIncluded).map((source) => source.id),
    wholeFile: ['Old card', 'Chequing'],
    inRange: ['Chequing'],
  },
  {
    name: 'the currency each account states',
    read: (isRowIncluded) => getStatedCurrencyByAccountSource(FILES, 'Account', 'Currency', new Set(['CAD', 'USD']), isRowIncluded),
    wholeFile: { 'Old card': 'USD', Chequing: 'CAD' },
    inRange: { Chequing: 'CAD' },
  },
]

describe('asking only about the rows inside the chosen dates', () => {
  // The whole file's answer is checked too, so a reader ignoring the filter can't pass by accident
  it.each(READERS)('reads $name from the rows inside the dates alone', ({ read, wholeFile, inRange }) => {
    expect(read(includeEveryImportRow)).toEqual(wholeFile)
    expect(read(MARCH)).toEqual(inRange)
  })
})

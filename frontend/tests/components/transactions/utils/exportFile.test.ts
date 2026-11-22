/**
 * Covers what the export button saves and says, when it is held off, what the saved file is called and
 * how a failure is worded, since a label that names the wrong scope, or an export offered to a person
 * with nothing to export, leaves them with a file they did not ask for or none
 */
import { describe, expect, it } from 'vitest'
import { buildApiError } from '@/api/auth'
import type { TransactionListFilters } from '@/components/transactions/types/transactionList'
import {
  EXPORT_LABELS,
  getExportBlockReason,
  getExportFilename,
  getExportScope,
  TRANSACTIONS_EXPORT_REASONS_BY_STATUS,
} from '@/components/transactions/utils/exportFile'
import { getActiveFilterCount } from '@/components/transactions/utils/filterOptions'
import { getDownloadFailureMessage } from '@/utils/downloadFailure'

describe('getExportScope', () => {
  it('exports everything when nothing narrows the list and nothing is ticked', () => {
    expect(getExportScope({ selectedCount: 0, isNarrowed: false })).toBe('all')
  })

  it('exports what the search and filters keep when they narrow the list', () => {
    expect(getExportScope({ selectedCount: 0, isNarrowed: true })).toBe('filtered')
  })

  it('exports only the ticked rows, with or without a filter on', () => {
    expect(getExportScope({ selectedCount: 1, isNarrowed: false })).toBe('selected')
    expect(getExportScope({ selectedCount: 12, isNarrowed: true })).toBe('selected')
  })

  it.each<[string, TransactionListFilters]>([
    ['tag', { tag_id: ['work'] }],
    ['account', { account_id: ['everyday'] }],
    ['category', { category_id: ['groceries'] }],
    ['merchant', { merchant_id: ['costco'] }],
    ['currency', { currency: 'USD' }],
    ['smallest amount', { min_amount: 0 }],
    ['largest amount', { max_amount: 5000 }],
    ['date', { from_date: '2026-06-01' }],
  ])('says Export filtered when only the %s filter is on', (_name, filters) => {
    // The list passes this count to the scope, so a filter the count misses would export everything
    const isNarrowed = getActiveFilterCount(filters, true) > 0

    expect(EXPORT_LABELS[getExportScope({ selectedCount: 0, isNarrowed })]).toBe('Export filtered')
  })

  it('says Export all when no filter is on', () => {
    expect(EXPORT_LABELS[getExportScope({ selectedCount: 0, isNarrowed: getActiveFilterCount({}, true) > 0 })]).toBe(
      'Export all',
    )
  })

  it('words the button after each scope', () => {
    expect(EXPORT_LABELS).toEqual({ all: 'Export all', filtered: 'Export filtered', selected: 'Export selected' })
  })
})

describe('getExportBlockReason', () => {
  it('holds the export off with a reason when nothing narrows the settled list and it is empty', () => {
    expect(getExportBlockReason({ isLoaded: true, hasError: false, rowCount: 0, isNarrowed: false })).toBe(
      'There are no transactions to export',
    )
  })

  it('holds the export off with its own reason when the search or filters keep nothing', () => {
    expect(getExportBlockReason({ isLoaded: true, hasError: false, rowCount: 0, isNarrowed: true })).toBe(
      'No transactions match the search or filters',
    )
  })

  it('holds the export off while the list has not loaded', () => {
    expect(getExportBlockReason({ isLoaded: false, hasError: false, rowCount: 0, isNarrowed: false })).toBe(
      'Transactions are still loading',
    )
  })

  it('allows the export when the list has rows', () => {
    expect(getExportBlockReason({ isLoaded: true, hasError: false, rowCount: 3, isNarrowed: true })).toBeUndefined()
  })

  it('leaves the export on when the list failed to load, so the empty list is not claimed', () => {
    expect(getExportBlockReason({ isLoaded: false, hasError: true, rowCount: 0, isNarrowed: false })).toBeUndefined()
  })
})

describe('the transactions export failure reasons', () => {
  it.each([
    [
      'a ticked row deleted elsewhere',
      buildApiError(404, { detail: '1 of 3 transactions were not found' }),
      'Nothing was downloaded: 1 of 3 transactions were not found',
    ],
    [
      'a 404 with an empty body',
      buildApiError(404, null),
      "Nothing was downloaded: the transactions couldn't be found. Please refresh the list and try again.",
    ],
    [
      'a 413 with an empty body',
      buildApiError(413, null),
      'Nothing was downloaded: the request was too large. Please select fewer transactions and try again.',
    ],
  ])('gives the reason for %s', (_name, error, expected) => {
    expect(getDownloadFailureMessage(error, TRANSACTIONS_EXPORT_REASONS_BY_STATUS)).toBe(expected)
  })
})

describe('getExportFilename', () => {
  it('names the file after the day it was made', () => {
    expect(getExportFilename('2026-10-30')).toBe('lumina-finance-transactions-2026-10-30.csv')
  })
})

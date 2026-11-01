/**
 * Covers what the export button saves and says, when it is held off, what the saved file is called and
 * how a failure is worded, since a label that names the wrong scope, or an export offered to a person
 * with nothing to export, leaves them with a file they did not ask for or none
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/auth'
import {
  EXPORT_FAILED_MESSAGE,
  EXPORT_LABELS,
  getExportBlockReason,
  getExportFailureMessage,
  getExportFilename,
  getExportScope,
} from '@/components/transactions/utils/exportFile'
import { getActiveFilterCount } from '@/components/transactions/utils/filterOptions'

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

  it.each([
    ['tag', { tag_id: ['work'] }],
    ['account', { account_id: ['everyday'] }],
    ['category', { category_id: ['groceries'] }],
    ['merchant', { merchant_id: ['costco'] }],
    ['currency', { currency: 'USD' }],
    ['smallest amount', { min_amount: 0 }],
    ['largest amount', { max_amount: 5000 }],
    ['date', { from_date: '2026-06-01' }],
  ] as const)('says Export filtered when only the %s filter is on', (_name, filters) => {
    // The list passes this count to the scope, so a filter the count misses would export everything
    const isNarrowed = getActiveFilterCount({ ...filters }, true) > 0

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

describe('getExportFailureMessage', () => {
  it('says nothing was downloaded for a server fault instead of its status text', () => {
    const message = getExportFailureMessage(new ApiError('Internal Server Error', 500))

    expect(message).toBe(EXPORT_FAILED_MESSAGE)
    expect(message).toContain('nothing was downloaded')
  })

  it('says nothing was downloaded when no answer came at all', () => {
    expect(getExportFailureMessage(new TypeError('Failed to fetch'))).toBe(EXPORT_FAILED_MESSAGE)
  })

  it('gives the reason of a refusal the server explained after saying nothing was downloaded', () => {
    expect(getExportFailureMessage(new ApiError('Session expired', 401))).toBe(
      'Nothing was downloaded: session expired',
    )
  })

  it('says nothing was downloaded when a ticked row was deleted elsewhere', () => {
    expect(getExportFailureMessage(new ApiError('1 of 3 transactions were not found', 404))).toBe(
      'Nothing was downloaded: 1 of 3 transactions were not found',
    )
  })
})

describe('getExportFilename', () => {
  it('names the file after the day it was made', () => {
    expect(getExportFilename('2026-10-30')).toBe('lumina-finance-transactions-2026-10-30.csv')
  })
})

/**
 * Covers what the export button saves and says, when it is held off, what the saved file is called and
 * how a failure is worded, since a label that names the wrong scope, or an export offered to a person
 * with nothing to export, leaves them with a file they did not ask for or none
 */
import { describe, expect, it } from 'vitest'
import { ApiError, buildApiError } from '@/api/auth'
import type { TransactionListFilters } from '@/components/transactions/types/transactionList'
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

describe('getExportFailureMessage', () => {
  it('says nothing was downloaded for a server fault instead of its status text', () => {
    const message = getExportFailureMessage(new ApiError('Internal Server Error', 500))

    expect(message).toBe(EXPORT_FAILED_MESSAGE)
    expect(message).toContain('nothing was downloaded')
  })

  it('says nothing was downloaded when no answer came at all', () => {
    expect(getExportFailureMessage(new TypeError('Failed to fetch'))).toBe(EXPORT_FAILED_MESSAGE)
  })

  it.each([
    [
      'a session that expired',
      new ApiError('Session expired', 401),
      'Nothing was downloaded: your session has expired. Please sign in again.',
    ],
    [
      'a token the server called inactive',
      buildApiError(401, { detail: 'Token is not active' }),
      'Nothing was downloaded: your session has expired. Please sign in again.',
    ],
    [
      'a restricted session the server explained',
      buildApiError(403, { detail: 'Set up two-factor sign-in again before you continue' }),
      'Nothing was downloaded: set up two-factor sign-in again before you continue',
    ],
    [
      'a gateway answering 403 with an empty body',
      buildApiError(403, null),
      "Nothing was downloaded: you don't have permission to export. Please check with whoever runs the app.",
    ],
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
      'a refusal naming one filter field',
      buildApiError(422, { detail: [{ loc: ['query', 'min_amount'], msg: 'bad' }] }),
      "Nothing was downloaded: the min amount wasn't accepted. Please check it and try again.",
    ],
    [
      'a refusal the server worded as a sentence',
      buildApiError(422, { detail: 'Start date must be before end date' }),
      'Nothing was downloaded: start date must be before end date',
    ],
    [
      'a refusal whose sentence opens with an acronym',
      buildApiError(422, { detail: 'CSV export needs a date range' }),
      'Nothing was downloaded: CSV export needs a date range',
    ],
    [
      'a 429 with an empty body',
      buildApiError(429, null),
      'Nothing was downloaded: too many requests were sent. Please wait a moment and try again.',
    ],
  ])('gives the reason for %s after saying nothing was downloaded', (_name, error, expected) => {
    expect(getExportFailureMessage(error)).toBe(expected)
  })

  it.each([
    ['a server fault with an empty body', buildApiError(500, null)],
    ['a bad gateway', buildApiError(502, null)],
    ['a server fault that carries a detail', buildApiError(500, { detail: 'upstream connect error' })],
    ['a service unavailable that carries a detail', buildApiError(503, { detail: 'upstream connect error' })],
    ['a refusal nothing explains', buildApiError(400, null)],
  ])('gives the plain failure message, never joined to the prefix, for %s', (_name, error) => {
    expect(getExportFailureMessage(error)).toBe(EXPORT_FAILED_MESSAGE)
  })
})

describe('getExportFilename', () => {
  it('names the file after the day it was made', () => {
    expect(getExportFilename('2026-10-30')).toBe('lumina-finance-transactions-2026-10-30.csv')
  })
})

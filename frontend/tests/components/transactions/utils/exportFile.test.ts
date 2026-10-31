/**
 * Covers when the export button is held off, what the saved file is called and how an empty file is
 * told from one with rows, since offering the export to a person with nothing to export, or saving a
 * file of one header row, leaves them with nothing
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/auth'
import {
  EXPORT_FAILED_MESSAGE,
  getExportBlockReason,
  getExportFailureMessage,
  getExportFilename,
  hasExportRows,
} from '@/components/transactions/utils/exportFile'

const HEADER = 'Date,Merchant,Category,Account,Tags,Amount,Currency,Notes\r\n'

describe('getExportBlockReason', () => {
  it('holds the export off with a reason when nothing narrows the settled list and it is empty', () => {
    expect(getExportBlockReason({ isLoaded: true, hasError: false, rowCount: 0, isNarrowed: false })).toBe(
      'There are no transactions to export',
    )
  })

  it('leaves the export on when filters or a search emptied the list, since the dialogue can widen them', () => {
    expect(getExportBlockReason({ isLoaded: true, hasError: false, rowCount: 0, isNarrowed: true })).toBeUndefined()
  })

  it('holds the export off while the list has not loaded', () => {
    expect(getExportBlockReason({ isLoaded: false, hasError: false, rowCount: 0, isNarrowed: false })).toBe(
      'Transactions are still loading',
    )
  })

  it('allows the export when the list has rows', () => {
    expect(getExportBlockReason({ isLoaded: true, hasError: false, rowCount: 3, isNarrowed: false })).toBeUndefined()
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

  it('keeps the wording of a refusal the server explained', () => {
    expect(getExportFailureMessage(new ApiError('Session expired', 401))).toBe('Session expired')
  })
})

describe('getExportFilename', () => {
  it('names the file after the day it was made', () => {
    expect(getExportFilename('2026-10-30')).toBe('lumina-finance-transactions-2026-10-30.csv')
  })
})

describe('hasExportRows', () => {
  it('is false for a file holding only the header row, with or without the byte order mark', async () => {
    expect(await hasExportRows(new Blob([HEADER]))).toBe(false)
    expect(await hasExportRows(new Blob(['﻿' + HEADER]))).toBe(false)
  })

  it('is true once a transaction row follows the header', async () => {
    const row = '2026-10-02,Costco,Groceries,Everyday,,-42.50,CAD,\r\n'

    expect(await hasExportRows(new Blob(['﻿' + HEADER + row]))).toBe(true)
  })
})

/**
 * Tests what a column has to hold to be accepted for the field it was mapped to, and what the
 * refusal tells the user about where the problem is
 */
import { describe, expect, it } from 'vitest'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'
import { validateColumnValues } from '@/pages/imports/utils'

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

/**
 * Builds a one-column file from the values it holds
 */
function createColumn(header: string, values: string[]) {
  return [createFile([header], values.map((value) => ({ [header]: value })))]
}

describe('refusing a column of numbers mapped to a field of names', () => {
  // Mapping the amount column to the category field reported no problem at all, so the import went
  // ahead and created categories called -12.34
  it('refuses an amount column mapped to the category field', () => {
    const files = createColumn('Amount', ['-12.34', '-8.00', '45.00'])

    const result = validateColumnValues(files, 'Amount', 'category_id', SUPPORTED_CURRENCY_CODES)

    expect(result.valid).toBe(false)
    expect(result.message).toContain('Every value in this column reads as an amount or a date.')
  })

  it('refuses a date column mapped to the account field', () => {
    const files = createColumn('Date', ['2026-04-11', '2026-04-12'])

    expect(validateColumnValues(files, 'Date', 'account_id', SUPPORTED_CURRENCY_CODES).valid).toBe(false)
  })

  it('refuses an account-number column mapped to the counterparty account field', () => {
    const files = createColumn('AccountNumber', ['1234567890', '9876543210'])

    expect(validateColumnValues(files, 'AccountNumber', 'counterparty_account_id', SUPPORTED_CURRENCY_CODES).valid)
      .toBe(false)
  })

  // The judgement is about the column as a whole, so a shop known by its store number does not
  // take the rest of the column down with it
  it('accepts a column of names holding one number', () => {
    const files = createColumn('Merchant', ['Corner Grocer', '7734', 'Corner Bakery'])

    expect(validateColumnValues(files, 'Merchant', 'account_id', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
  })

  it('accepts an all-numeric column mapped to a field that takes anything', () => {
    const files = createColumn('Reference', ['80012', '80013', '80014'])

    expect(validateColumnValues(files, 'Reference', 'notes', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
    expect(validateColumnValues(files, 'Reference', 'merchant_id', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
    expect(validateColumnValues(files, 'Reference', 'tag_ids', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
  })

  it('accepts a column of blanks without claiming it is all numbers', () => {
    const files = createColumn('Currency', ['', ''])

    const result = validateColumnValues(files, 'Currency', 'currency', SUPPORTED_CURRENCY_CODES)

    expect(result.message).not.toContain('reads as an amount or a date')
  })
})

describe('saying where the problem is', () => {
  it('agrees in number when one row is blank', () => {
    const files = createColumn('Account', ['Chequing', '', 'Savings'])

    expect(validateColumnValues(files, 'Account', 'account_id', SUPPORTED_CURRENCY_CODES).message)
      .toContain('1 row is blank.')
  })

  it('agrees in number when several rows are blank', () => {
    const files = createColumn('Account', ['Chequing', '', ''])

    expect(validateColumnValues(files, 'Account', 'account_id', SUPPORTED_CURRENCY_CODES).message)
      .toContain('2 rows are blank.')
  })

  // The message quoted the offending value with no way to find it, which in a file of thousands of
  // rows leaves the user searching
  it('gives the row the offending value sits on', () => {
    const files = createColumn('Currency', ['CAD', 'USD', 'ZZZ'])

    expect(validateColumnValues(files, 'Currency', 'currency', SUPPORTED_CURRENCY_CODES).message)
      .toContain('Row 3 has "ZZZ", which does not match.')
  })
})

describe('promising only the checks that run', () => {
  it('does not claim a plain-text check on the fields that take anything', () => {
    const files = createColumn('Anything', ['-12.34'])

    for (const target of ['merchant_id', 'notes', 'tag_ids'] as const) {
      // The refusal is provoked by a blank column, which is the one way these fields fail, so the
      // wording describing what they expect is what gets read back
      const message = validateColumnValues([createFile(['Anything'], [])], 'Anything', target, SUPPORTED_CURRENCY_CODES).message

      expect(message).not.toContain('plain text')
    }

    expect(validateColumnValues(files, 'Anything', 'notes', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
  })
})

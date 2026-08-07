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

  it('refuses a money column mapped to the counterparty account field', () => {
    const files = createColumn('Amount', ['-1,234.56', '9.99'])

    expect(validateColumnValues(files, 'Amount', 'counterparty_account_id', SUPPORTED_CURRENCY_CODES).valid)
      .toBe(false)
  })

  // An account, a counterparty or a category can legitimately be known by a number, and a bare run
  // of digits is an identifier as often as it is money, so only money's own shape rules a column out
  it('accepts a column of bare identifiers, which are not money', () => {
    const files = createColumn('AccountNumber', ['1234567890', '9876543210'])

    for (const target of ['account_id', 'counterparty_account_id', 'category_id'] as const) {
      expect(validateColumnValues(files, 'AccountNumber', target, SUPPORTED_CURRENCY_CODES).valid).toBe(true)
    }
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

describe('checking one side of a file that writes money out and money in separately', () => {
  // Blanks are the shape of this arrangement rather than a fault in it, since a row states its
  // amount on one side and leaves the other empty. Held to the single Amount field's rule, the
  // column would be refused for the very thing that makes it one side of a pair
  it('accepts a column left blank on the rows carrying money the other way', () => {
    for (const target of ['amount_out', 'amount_in'] as const) {
      const files = createColumn('Debit', ['45.00', '', '12.00'])

      expect(validateColumnValues(files, 'Debit', target, SUPPORTED_CURRENCY_CODES).valid).toBe(true)
    }
  })

  it('accepts a column padded with zeros on those rows', () => {
    const files = createColumn('Debit', ['45.00', '0.00', '12.00'])

    expect(validateColumnValues(files, 'Debit', 'amount_out', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
  })

  // Refused here, before any row is judged, which is why the row rule only ever sees blanks and
  // numbers
  it('refuses a value that is not a number, and gives the row it sits on', () => {
    const files = createColumn('Debit', ['45.00', 'pending', '12.00'])
    const result = validateColumnValues(files, 'Debit', 'amount_out', SUPPORTED_CURRENCY_CODES)

    expect(result.valid).toBe(false)
    expect(result.message).toContain('Row 2')
    expect(result.message).toContain('pending')
  })

  // The single Amount field says every row must have a value, and repeating that against a side
  // would describe the opposite of what the field takes
  it('does not promise a value in every row', () => {
    const message = validateColumnValues(
      [createFile(['Debit'], [])],
      'Debit',
      'amount_out',
      SUPPORTED_CURRENCY_CODES,
    ).message

    expect(message).not.toContain('every row must have a value')
  })

  // The sign a value carries is read rather than refused, since it is what tells a refund in a column
  // of purchases from the purchases around it. Which sign the column writes its own direction with
  // is answered beside the column instead
  it('accepts a money out column carrying negative and positive amounts together', () => {
    const files = createColumn('Debit', ['-45.00', '1200.00'])

    expect(validateColumnValues(files, 'Debit', 'amount_out', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
  })

  it('accepts a money in column carrying a negative', () => {
    const files = createColumn('Credit', ['-30.00', '45.00'])

    expect(validateColumnValues(files, 'Credit', 'amount_in', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
  })

  // A statement period where every transaction went one way leaves the other side empty, and that is
  // the file as the bank wrote it rather than a mapping mistake. Refusing the column would block an
  // import the two sides read perfectly well
  it.each([['amount_out'], ['amount_in']] as const)('accepts a %s column left blank on every row', (target) => {
    const files = createColumn('Debit', ['', '', ''])

    expect(validateColumnValues(files, 'Debit', target, SUPPORTED_CURRENCY_CODES).valid).toBe(true)
  })

  // The unused side of a file that pads rather than leaves blank, which is a real mapping and the
  // shape this arrangement was built for
  it('accepts a side holding nothing but zeros', () => {
    const files = createColumn('Credit', ['0.00', '0.00'])

    expect(validateColumnValues(files, 'Credit', 'amount_in', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
  })

  // A zero runs neither way, and padding the unused side with one is the layout this arrangement was
  // built for, so a zero among negatives is not a column mixing directions
  it('does not read a zero as the positive half of a mixed column', () => {
    const files = createColumn('Debit', ['-45.00', '0.00', '-12.00'])

    expect(validateColumnValues(files, 'Debit', 'amount_out', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
  })
})
